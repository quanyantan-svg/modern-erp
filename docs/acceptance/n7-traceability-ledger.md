# N7 变更追溯台账（N7-LEDGER-01）

> 状态：`ACTIVE`
> Owner：业务所有者（裁定）；Platform（台账维护）
> 权威来源：[`docs/decisions/n7-traceability-ledger-policy-20261113.md`](../decisions/n7-traceability-ledger-policy-20261113.md)（`N7-LEDGER-01`，`APPROVED`）
> 门禁实现：`scripts/docs/lib/n7-traceability-ledger.mjs`；判定入口 `scripts/docs/check-doc-consistency.mjs` 的 N7。
>
> 本台账是 N7「变更记录 + Git Diff」可追溯性判定的**第二个「变更记录」来源**。提交信息路径完全保留；
> 台账只覆盖「提交信息不合规但变更本身可追溯」的**历史**提交。

## 覆盖合同

一个条目覆盖某个不合规提交，当且仅当下列全部成立：

1. **提交 SHA 精确相等**（完整 40 位十六进制，不接受短 SHA）。
2. **受治理文件路径精确相等**。
3. **章节 id 集合与该提交在该文件上实际触达的章节集合完全相等**；无法归属章节的变更要求章节集合为空。
4. **引用的所有者决定文件存在**，且其元数据「状态」含 `APPROVED`。
5. 条目**确实对应一个实际不合规提交** —— 不再对应的条目会被报出并要求删除。

**不得豁免**：受治理文件的整体删除或移动；台账机制自身。

## 登记纪律

- 本台账**不得**用于让未来提交通过 —— 未来提交必须在自己的提交信息里写明完整路径或全部章节 id。
- 新增条目必须同时满足：已批准的所有者决定存在、章节 id 集合与实际触达集合完全相等。
- 台账条目失效时（对应提交已被修复或消失）必须删除该条目，否则门禁报 `台账条目不再对应任何不合规提交`。

## N7-LEDGER-01 台账条目

> **行格式**：四列 —— 提交 SHA（**必须**用反引号包裹的完整 40 位十六进制）、受治理文件、章节 ID
> （多个用逗号分隔；无法归属章节时写「（无归属章节）」）、所有者决定（`docs/decisions/` 下的文件路径）。
> 未用反引号包裹提交 SHA 的行是表头行，不被解析。

| 提交 SHA | 受治理文件 | 章节 ID | 所有者决定 |
|---|---|---|---|
| `a40e356aa870931d326817485886cf794ca44607` | `docs/status/PROJECT_STATUS.md` | `45.16` | `docs/decisions/n7-traceability-ledger-policy-20261113.md` |
| `59eccd54d33e5a95c43c1e3e78d5b4b5ecb6d357` | `docs/status/PROJECT_STATUS.md` | `37.32` | `docs/decisions/n7-traceability-ledger-policy-20261113.md` |
| `171ade577bad46093ede64e081d6cf55132693cd` | `docs/status/PROJECT_STATUS.md` | `37.21` | `docs/decisions/n7-traceability-ledger-policy-20261113.md` |
| `4403a80d254350ce9ebe4a8c746fbb1006dd67c4` | `docs/reviews/README.md` | （无归属章节） | `docs/decisions/n7-traceability-ledger-policy-20261113.md` |
| `4403a80d254350ce9ebe4a8c746fbb1006dd67c4` | `docs/reviews/m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md` | （无归属章节） | `docs/decisions/n7-traceability-ledger-policy-20261113.md` |

### 条目依据

| 提交 | 缺失项 | 实际情况 |
|---|---|---|
| `a40e356` | `§45.16` | 2026-11-09 登记 OUT-001 候选基线冻结与真实 MySQL Gate 待执行状态，写入 `PROJECT_STATUS.md` §45.16 |
| `59eccd5` | `§37.32` | 2026-11-04 登记 M1C-WP7-COMBINED 实施，写入 `PROJECT_STATUS.md` §37.32 |
| `171ade5` | `§37.21` | 2026-11-02 登记 M1C-WP1 实施验收，写入 `PROJECT_STATUS.md` §37.21 |
| `4403a80` | 完整路径 | 2026-11-03 起草委外加工费 PO 正式可达设计修订：新增 `docs/reviews/m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md` 并在该目录索引 `docs/reviews/README.md` 登记一行 |

四个提交均**已推送到 `github/master`**；本台账的设立正是为了**不触碰已发布历史**而保留其可追溯性
（见 [`docs/decisions/n7-traceability-ledger-policy-20261113.md`](../decisions/n7-traceability-ledger-policy-20261113.md) §3）。
