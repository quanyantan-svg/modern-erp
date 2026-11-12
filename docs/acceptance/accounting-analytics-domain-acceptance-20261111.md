# Accounting & Analytics 域级 Acceptance 与 Capability Freeze 记录（2026-11-12）

> **用途**：登记业务所有者对 Accounting & Analytics 域**整域 Acceptance** 与 **Capability Freeze** 的最终决定、证据、冻结边界与未关闭事项。
>
> **Owner**：Accounting & Analytics Domain Owner（Acceptance 与 Freeze 的唯一签字人）；Platform / QA（证据维护）。
>
> **状态**：`FROZEN` —— 域级 Acceptance 已签发；43 项 `COVERED` 能力已冻结。**Manual Closure、Release Readiness、发布与部署不在本记录范围内。**
>
> **权威来源**：Requirement [`docs/requirements/accounting-analytics.md`](../requirements/accounting-analytics.md) §35.1～§35.10；Design [`docs/design/accounting-analytics.md`](../design/accounting-analytics.md) §31.0～§31.15；唯一项目状态登记表 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) §53；能力覆盖矩阵 [`docs/status/CAPABILITY_MATRIX.md`](../status/CAPABILITY_MATRIX.md)；逐项判定 [`docs/audits/accounting-analytics-capability-audit-20261110.md`](../audits/accounting-analytics-capability-audit-20261110.md) §7。
>
> 本文件是验收与冻结证据，不取代 Requirement、Design 或唯一项目状态登记表；其生成不等于 Git 提交、远端同步、发布或部署。

```text
ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS
ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE
```

## 1. Owner 决定与冻结边界

业务所有者在本轮对话中先后指示：「w1、w2、w3 和 w5 应该已经做完 请接着做剩余wave 最终目标是域级acceptance和freezen」；
对 AA-07 委外成本的合同缺位裁定「A：裁定归采购委外域，本域只引用」；对真实 MySQL Gate 裁定「授权本域 ACK-4 campaign」；
对四处真实缺陷裁定「你修复完成后 就批准域级验收」。据此作出以下决定：

| 项 | 决定 |
|---|---|
| 域级 Acceptance | **通过**（`ACCOUNTING_ANALYTICS_DOMAIN_ACCEPTANCE_PASS`） |
| Capability Freeze | **冻结 43 项 `COVERED` 能力**（`ACCOUNTING_ANALYTICS_CAPABILITY_FREEZE`） |
| 能力判定 | AA-01..AA-44 共 44 项：**43 `COVERED`**、**0 `PARTIAL`**、**0 `MISSING`**、**1 项按已批准决定排除在本域范围外**（AA-31 汇兑损益 / 多币种，业务所有者 2026-11-10 裁定） |
| AA-07 委外成本 | 口径由 Procurement & Outsourcing 域已冻结的 canonical 实现承担，本域按 §35.4.6 AA-W6.17～AA-W6.19 只做**权威事实引用**；**不是**实现缺口，**不得**被描述为已由本域实现 |
| 实现锚点 | `003fc8cd1cc67ff1f59c6facf4bd84902e625366`（含四处真实缺陷的回归测试与目录还原健壮性修正） |
| 范围包锚点 | AA-W1+AA-W2 `3876bd3`、AA-W5 `e40a015`、AA-W3 `943414c`、AA-W6 `5e6739d`、AA-W4 `bc2035d`、AA-W7 `d9e7319`；前端工作面 `9e1ddd4`；AA-W6.7 可回看与共享断言同步 `7dc7766` |
| 真实 MySQL Gate（本域） | run `52ee28ff-377c-4558-a0d8-d4e7824a8c47`（commit `003fc8cd`）→ `RESULT = PASS`、`state=FINISHED`、清理由 root 独立 post-flight 证明 |
| 真实 MySQL Gate（跨域复核） | M1-Core G07 重跑 run `b4e124fe-ae09-44fd-927a-6a4d1eb518ed`（commit `003fc8cd`）→ `RESULT = PASS`、`state=FINISHED`，确认采购与委外域已签发的 PASS 在修正后的报告器下**依然成立** |

决定来源是当前对话中所有者的明确指令；不存在虚构的手写签名、电子签章、外部审批单或未发生的真实 MySQL 运行记录。

**冻结范围**：AA-W1..AA-W7 七个范围包实施后的本域 Active Contract（Requirement §35.1～§35.10 / Design §31.0～§31.15）
及其 43 项 `COVERED` 能力的实现、schema、测试与证据。

**冻结不包含**：Manual Closure（B3106 / B3107 / B3114–B3117 手册级关闭）、Release Readiness、发布、部署、
真实环境 migration、业务数据库写入、远端 Git 操作，以及其他 Domain 的 Acceptance。

## 2. 验收证据

| Gate | 结果 |
|---|---|
| `pnpm test:fast` | **632/632 PASS** |
| `pnpm test`（FULL） | **3708/3708 PASS**，0 失败（459 个套件） |
| `pnpm test:heavy` | **67/67 PASS** |
| `pnpm build` | PASS |
| `git diff --check` | PASS |
| focused（AA-W1..AA-W7 六个契约套件） | **85/85 PASS** |
| focused（14 个共享 route 清单套件） | **250/250 PASS** |
| focused（域级 schema 双引擎离线对等，新登记） | **53/53 PASS** |
| focused（四处真实缺陷的回归测试，新登记） | **13/13 PASS**（重复键映射 5 + 目录渲染 5 + 门禁报告器 3） |
| 浏览器四档宽度验收（真实 Edge，6 个工作面 × 320/390/430/680） | **6/6 PASS**，浏览器错误 **0**；证据 [`docs/evidence/accounting-analytics/README.md`](../evidence/accounting-analytics/README.md) |
| 真实 MySQL 8.0.37 parity / concurrency（受保护 disposable 目标） | **PASS**：run `52ee28ff-377c-4558-a0d8-d4e7824a8c47` @ `003fc8cd`；47 张表目录对等、七个包的权威写入路径、三条并发 UNIQUE 边界、金额安全整数分全部通过；`ACK-4 STATE = FINISHED`，清理独立 post-flight 证明（运行前后目标库对象数均为 0） |
| 文档一致性 `current` | N1、N3～N6、N8、N9 **PASS**；N2 `RETIRED`；**N7 FAIL**（既存历史提交 `a40e356` / `59eccd5` / `171ade5` / `4403a80` 的追溯债务，与本域无关） |
| 文档一致性 `migration` | C1～C6 全 PASS |

## 3. 真实 MySQL Gate 的覆盖与限制

**覆盖**：本域 45 张新表与 AA-W5 加列的两张既有表（共 47 张）在真实 MySQL 8 目录上的列集合、NULL 约束、
UNIQUE 与 CHECK 条款与 canonical SQLite 快照逐项一致；AA-W1 科目维护与事件台账、AA-W1 对账快照、
AA-W2 凭证模板与规则、AA-W4 报表生命周期、AA-W5 政策折旧并生成可对账凭证（同期间幂等）、
AA-W6 暂估差异调整凭证、AA-W7 经营账簿与关账前置，全部在真实 MySQL 上成立，权威事实由第三个进程直接从
MySQL 读取判定；两条独立应用进程共享同一个 MySQL 库并发写入时，会计科目、凭证模板、核算范围三条 UNIQUE
边界各只有一个成功、另一个被拒，且权威表中只落一条；本域全部 `*_cents` 列都是安全整数分。

**限制（随冻结一并接受）**：

1. campaign **不**覆盖本域全部 85 条契约用例 —— 逐条契约用例以本地 SQLite 套件（85/85）为准；
2. campaign **不**覆盖 MySQL 下的**库存估值并发**（该并发属 Inventory 域）；
3. campaign 只在**受保护 disposable 目标**上运行，**不**代表任何生产或业务数据库的运行期验收。

## 4. 本轮修复的真实缺陷（全部由真实 MySQL Gate 暴露）

| 缺陷 | 影响面 | 修复 |
|---|---|---|
| MySQL 重复键冲突返回 **500** 而非 409（驱动把 `ER_DUP_ENTRY` 放在错误码上，消息里只有人类可读文本） | **跨域**：任何域的并发唯一键冲突在 MySQL 上都是 500 | `server/app.js` 抽出 `isDuplicateKeyConflict(error)` 并同时检查错误码；回归测试 `server/app-duplicate-key-mapping.test.js`（5 条，含负例） |
| `information_schema` 字符串列声明为 latin1，驱动把服务端的 utf8mb4 字节逐字节解码，中文默认值以字节片段到达，schema 对等无法与 canonical SQLite 文本相等 | 跨域：任何依赖目录默认值的对等比较 | 比较器按 UTF-8 还原目录列文本；回归测试 `server/m1-core-schema-parity-catalogue.test.js`（5 条，含「还原前必须确实不等」的负例） |
| MySQL 目录把字符串字面量渲染成带反斜杠转义的定界符，比较器只接受单反斜杠形式 | 同上 | 比较器把「反斜杠串 + 引号」整体当作定界符；回归测试同上 |
| 受保护门禁的 TAP 报告器只监听 `test:fail` 事件，嵌套子测试的失败不一定到达该事件，**失败套件被报成 PASS** | **跨域**：任何使用该报告器的受保护门禁 | 报告器同时扫描合成 TAP 的 `not ok` 行；回归测试 `scripts/gates/m1-core-g07-suite-reporter.test.js`（3 条，以子进程退出码为断言）；采购与委外域的 M1-Core G07 已按修正重跑确认仍为 PASS（run `b4e124fe-ae09-44fd-927a-6a4d1eb518ed`） |

## 5. 随冻结一并接受的残余

1. **既有 `accounting.jsx` 未改造**：其中「未结转损益（虚拟行，不持久化）」的资产负债表展示行仍保留，
   尽管 AA-W3 已实现真实损益结转并从结转链移除虚拟权益行补偿；该展示行与真实结转事实的一致性**未取得浏览器取证**。
2. **试算平衡科目集合由 21 增至 27**：AA-W3 的 `4103` 与 AA-W5 的 `1601` / `1602` / `6602` / `6603` 入列，
   既有损益表与资产负债表口径不变。
3. **共享套件的固化计数断言**曾因本域改动（权限 227→247、active route 74→79、disabled 5→4）失效，
   已逐条同步并附改动理由注释；**未**放宽业务语义断言、**未**删除断言、**未**降级测试分类。
4. **N7 仍 FAIL**：成因是四个既有历史提交的追溯债务，与本域无关；本域**未**把它写成 PASS。
5. **真实环境 migration 与业务数据库写入未执行**。

## 6. 未签发项

- **Manual Closure**（B3106 / B3107 / B3114–B3117 手册级关闭）是独立决定，本记录不签发；
- **Release Readiness** 与任何 Domain 的发布授权不签发；
- 真实环境 migration、业务数据库写入、发布、部署、远端 Git 操作（push / tag / merge）未执行。

## 7. 冻结后的变更约束

本域 Active Contract（Requirement §35、Design §31）与其 43 项 `COVERED` 能力自本记录起**冻结**。
任何对本域合同、实现、schema 或测试的修改必须先走显式解冻；跨域合同变更（会计科目、期间关闭、库存估值、
委外成本归属）必须回到对应 Domain 的 Requirement / Design 层重新裁定。
