# M1-Core G01～G06 集中候审与 G07 最终诊断收口（2026-11-05）

> 用途：汇总 `M1C-G01`～`M1C-G06` 已有 Requirement → Implementation → Test Evidence，
> 区分真实证据缺口与仅待 Owner 裁定项，并登记 G07 Suite 失败证据链的离线收口。
> Owner：Procurement & Outsourcing Domain Owner（Gate 与包级正式决定）；Platform / QA（技术证据维护）。
> 状态：`PENDING_APPROVAL` —— 本文只形成候审材料，不签发任何 Gate PASS、M1-Core Acceptance 或 Freeze。
> 权威来源：Requirement `docs/requirements/procurement-outsourcing.md` §31.13.5、Active Design
> `docs/design/procurement-outsourcing-m1-core.md` §13.1、唯一项目状态登记
> `docs/status/PROJECT_STATUS.md`。本文是证据索引，不替代上述权威正文。

## 1. 基线与审查边界

- 已推送实施基线：`2ed357123a4ef5501575eeca266ec9a20d4341e9`；其真实 G07 执行记录提交
  `ccb3aa1b4cffffb15013e7273db43e4a74441e5c` 完整保留，未 amend、未重写。
- 本轮 G07 诊断实现提交：`c9e63f268055fbdd64b3daf07e0bf4ad8e65bc93`。
- 本轮只运行离线 focused tests、PowerShell 解析和文档/Git 校验；未连接 MySQL、未签发或消费 ACK-4、
  未执行 Gate、Reset、Bootstrap、Cleanup 或 Migration。
- G01～G06 的业务实现未在本轮改变。对已有且对应代码无新增业务变化的 HTTP/Browser 证据不做无意义重跑；
  历史执行结果仍按其原始 SHA 和证据层级引用，不伪装为本轮新执行结果。

## 2. G07 Suite 失败证据链离线收口

`mysql-m1-core-gate.mjs::finishChild()` 现在先等待 stdout/stderr 完整 drain；Suite 非零退出时解析 stdout
中的 node:test TAP，收集全部可识别的 `not ok`，逐项输出名称、failure type/code、关键断言和可用堆栈，
同时把 stderr 单独标识。Launcher 优先输出完整的标记摘要，不再把关键项盲目截在最后 40 行之外。

完整 stdout/stderr 在写盘前统一脱敏，证据文件位于当前用户 `%LOCALAPPDATA%/ModernERP/mysql-gate/evidence/<runId>/`；
Windows DACL 只授予当前用户，ACL 加固失败则删除文件并显式报告 `EVIDENCE_WRITE_ERROR`。Bearer、密码、Token、
Capability、Authorization 与 MySQL URL 密码均有负向测试。摘要形态如下（纯模拟数据）：

```text
M1_G07_DIAGNOSTIC_SUMMARY_BEGIN
CHILD_EXIT=1 MODE=suite OPERATION=RUN_M1_HTTP_FIXTURES
TAP_FAILURE_TOTAL=2 IDENTIFIABLE_FAILURES=2
FAILURE[1] NAME=CR-03 confirm race
FAILURE[2] NAME=SCHEMA-PARITY column drift
FULL_DIAGNOSTIC_FILE=<current-user restricted local path>
M1_G07_DIAGNOSTIC_SUMMARY_END
```

离线负向矩阵：

| 场景 | 证明 |
|---|---|
| stdout 有 `not ok`、stderr 空、exit 1 | 失败名称、断言、stack 均进入 Root error 与本地证据；不得退化为只有 `M1_G07_CHILD_FAILED:1` |
| 多项失败 | `TAP_FAILURE_TOTAL` 与全部可识别 `FAILURE[n]` 均输出，不只保留末项 |
| stdout 有关键断言、stderr 非空 | stdout 失败逐项保留，stderr 以 `STDERR_SUMMARY` 和独立证据段区分 |
| exit 0 | 保持 PASS，不创建 failure error/证据文件 |
| Root `FAILED` + `cleanupProven=true` | TAP 详情穿透 Root，状态仍为 `FAILED`；Launcher 既有 exit 5 不变 |
| Root `CLEANUP_UNVERIFIED` | `testsPassed=false`、`cleanupProven=false`、Quarantine 保持；绝不误判 PASS |

Suite 的业务断言、PASS/FAIL 判定、ACK-4、Cleanup、Quarantine 与失败退出语义均未放宽或绕过。

## 3. G01～G06 Requirement → Implementation → Evidence 矩阵

状态列只使用合同允许的执行结论。由于本文没有 Owner 签发权限，技术证据充分但仅待签字的 Gate 仍记
`INCONCLUSIVE / OWNER_DECISION_ONLY`，不得冒充 PASS。

| Gate | Requirement / 实施映射 | 已有测试证据 | 独立支持 | 候审状态 | 精确剩余项 |
|---|---|---|---|---|---|
| G01 | §31.13.5：通知来源、分域容量、转换、交期台账、直接 PO；`procurement-receiving.js`、`procurement-notice-conversion.js`、`procurement-notice-capacity.js` | WP7-A §3.1：L1 HTTP SQLite 25 例及 R1/R2；`m1c-wp1-procurement-notice-conversion.test.js`；后续 `84bca44` 补并发错误码/编号 focused 回归 | WP1 Implementation Acceptance 只证明实现包，不是 Gate 审查 | `INCONCLUSIVE` | 合同明确要求 `HTTP + SQLite/MySQL`；真实 MySQL Suite 没有可恢复逐项结果，MySQL 半边是真缺口 |
| G02 | §31.13.5：正式明细、逐行来源、IQC PASS/WAIVED、待检/生效分离、收货员 SOD；`outsourcing.js`、`outsourcing-finance.js` | WP7-A §3.2：生产 HTTP、正式收货员正向、错误角色 403、IQC/库存/成本、重复确认零副作用；R1 幂等 8 例、通知容量 15 例 | 无单独 Gate 独立审查 | `INCONCLUSIVE / OWNER_DECISION_ONLY` | 无新增技术证据缺口；只待 Owner 核验现有证据并签发或给出精确拒绝理由 |
| G03 | §31.13.5 / Design §13.1.1：canonical 库存/跟踪/估值、企业所有权、WIP 对账、L1/L2 幂等；`outsourcing-inventory.js`、`inventory-mutation.js` | WP7-A §3.3：L1 SQLite HTTP 与逐字段快照；WP7 combined：L2 strict mutation collision、schema parity/current-schema assertions；G07 offline Oracle negative controls | Design 分层获批，不等于 Gate 独立审查 | `INCONCLUSIVE` | 真实 MySQL 的 current-schema 身份唯一性、行为 parity 与 Suite 逐项结果仍缺；历史 M-15 Migration 不属于此空库证据缺口 |
| G04 | §31.13.5：增量倒冲、canonical 位置成本、唯一成品 Writer、重复/并发不双扣双收；`outsourcing-finance.js` 与 canonical inventory/valuation writer | WP7-A §3.4：SQLite HTTP、位置成本负控、Movement+Balance、重复确认；G07 CR-03/07/08 Oracle 已离线完备 | 无单独 Gate 独立审查 | `INCONCLUSIVE` | “并发不双扣/双收”的真实 Handler/MySQL 结果仍缺；不能用重复确认或离线 Oracle 代替 |
| G05 | §31.13.5：两工作面、四宽度、无 TypeError、服务端 RBAC；`applicationRegistry.js`、两个页面、正式 dist 浏览器脚本 | 修复后 Browser `24/24`：3 主体 × 2 工作面 × 4 宽度；真实 DOM/GET/动作/403/异常/横向溢出 | `M1C_G05_INDEPENDENT_REVIEW_PASS` | `INCONCLUSIVE / OWNER_DECISION_ONLY` | 唯一剩余项是 Domain Owner 正式 Acceptance；G07/MySQL 与 G05 无依赖 |
| G06 | §31.13.5：延期危险写入专用/共享 POST/MATCH/内部链拒绝，普通采购防误伤；`outsourcing-gl-policy.js` 及 supplier bill guard | WP7-A §3.6 + `m1c-outsourcing-gl-policy-guard.test.js`：409/403、普通采购成功、十类快照零变化、拒绝审计恰一 | 无单独 Gate 独立审查 | `INCONCLUSIVE / OWNER_DECISION_ONLY` | 无新增技术证据缺口；只待 Owner 签发或指出具体未满足断言 |

## 4. G05 Owner Acceptance 决策包

Owner 可直接核验以下闭集，无需等待 G07：

1. 原始 `16/24` 失败记录未被覆盖；修复提交为 `8559c03f78898b0b059330f096a4e1bde694f277`。
2. canonical registry 已可加载两个独立页面 chunk；委外动作使用当前用户与既有后端 permission contract。
3. 修复后 Browser 证据为 `24/24`，覆盖 320/390/430/680、admin/委外业务员/销售专员、真实目标 DOM、
   页面自身 GET、合法动作、403、业务错误展示、无未捕获异常和无横向溢出。
4. 独立技术结论为 `M1C_G05_INDEPENDENT_REVIEW_PASS`，且明确未冒充 Owner Acceptance。

建议裁定：如 Owner 接受上述闭集，单独签发 `M1C-G05 PASS`；如不接受，应记录具体失败断言或所需新增证据，
不得继续用泛化“证据不足”代替裁定。本文本身不签发该 PASS。

## 5. 延期政策、M-15 与首期边界

- `B-P01/B-P02` 高级跨单/跨期 WIP、`C-P01..C-P04` 最终加工费/AP/GL、`D-P01/D-P02` VMI 结算均为
  `DEFERRED_PENDING_POLICY`；它们不无条件阻塞首期 Gate。首期仍适用的合同是 G06 对危险写入 fail closed，
  该拒绝证据已经存在。
- G04 的首期证据是材料实耗账面价值 + 加工费 provisional 成本证据；不得把延期的最终会计确认/差异分摊
  反向升级为首期阻塞，也不得用 provisional 冒充最终 AP/GL closure。
- 新 disposable 空库经 current-schema bootstrap 建立 M-15 目标列/索引，只能证明当前 schema；不等于、也不需要
  冒充历史数据库 PRE-A/B/C、规范化与 Migration Acceptance。历史 M-15 仍须独立授权和独立验收。
- 两个 `mysqld` 进程与常见启动配置文件缺失风险继续 `OPEN`；本轮未终止进程、重启服务或修改全局参数。

## 6. 最小剩余阻塞与候审建议

真正缺少的技术证据只有：

1. G01 的真实 MySQL HTTP 结果（合同明确写明 SQLite/MySQL）。
2. G03 的真实 MySQL current-schema 身份唯一性、行为 parity 与逐项结果。
3. G04 的真实 Handler/MySQL 并发不双扣/双收结果。
4. G07 CR-01～CR-09、lock-wait、Parity/Oracle 的可恢复 Suite 结果；前次 exit 1 因 stdout 丢失均为
   `INCONCLUSIVE`，不能追认。

仅待 Owner 决定而非技术缺口：G02、G05、G06。历史 M-15 Migration、延期 WIP/VMI/GL 政策不在上述首期
阻塞清单中；它们保持各自独立状态。由于 G01/G03/G04/G07 仍有真实证据缺口，当前包级建议仍是：

```text
M1_CORE_ACCEPTANCE_BLOCKED
```

不得签发 `M1_CORE_ACCEPTANCE_PASS`。待未来另获新 SHA、新 Run ID、新 ACK-4 的单次 G07 授权后，本轮新增的
诊断链可使 Suite exit 1 直接给出具体失败测试与断言；本文不构成该授权。

## 7. 本轮离线验证

| 检查 | 结果 |
|---|---|
| G07 diagnostics + infrastructure + child lifecycle + ACK-4 | 35/35 PASS（纯离线，无 MySQL） |
| suite 分类治理 | 20/20 PASS；新增测试归入 FULL，`FAST ⊆ FULL`、`FULL ∩ HEAVY = ∅` 不变 |
| PowerShell 5.1 parser | PASS |
| 文档 current / N7 | N1、N3～N9 PASS（含 N7）；N2 按治理决定为 RETIRED，不计 PASS/FAIL |
| `git diff --check` | PASS |

未运行 FULL、Build、全部历史 UAT 或真实 MySQL Gate；本次代码变化仅为诊断与离线测试，重复这些既有通过项
不会增加对应业务 Gate 的证据质量。
