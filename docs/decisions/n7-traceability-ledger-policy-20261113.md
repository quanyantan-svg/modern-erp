# N7-LEDGER-01 —— 变更追溯台账（N7 的第二个「变更记录」来源）（2026-11-13）

> **决策 ID**：`N7-LEDGER-01`
> **归属**：业务所有者（治理裁定）；Platform（实现与维护）
> **状态**：`APPROVED`
> **规范来源锚点**：[`AGENTS.md`](../../AGENTS.md) §5.1.1 N7；实现 `scripts/docs/lib/n7-traceability-ledger.mjs` 与 `scripts/docs/check-doc-consistency.mjs`；台账正文 [`docs/acceptance/n7-traceability-ledger.md`](../acceptance/n7-traceability-ledger.md)。
> **不授权**：任何 Implementation、发布、部署或远端 Git 操作。

## 1. 背景

N7（"已批准合同的修改可经「变更记录 + Git Diff」追溯"）要求：区间内每个修改受治理文件的提交，其**提交信息**必须包含该文件的完整路径，或包含**全部**被触达章节的 id。

2026-11-13 的核查发现四个历史提交的提交信息不合规：

| 提交 | 受治理文件 | 缺失项 |
|---|---|---|
| `a40e356aa870931d326817485886cf794ca44607` | `docs/status/PROJECT_STATUS.md` | `§45.16` |
| `59eccd54d33e5a95c43c1e3e78d5b4b5ecb6d357` | `docs/status/PROJECT_STATUS.md` | `§37.32` |
| `171ade577bad46093ede64e081d6cf55132693cd` | `docs/status/PROJECT_STATUS.md` | `§37.21` |
| `4403a80d254350ce9ebe4a8c746fbb1006dd67c4` | `docs/reviews/README.md`、`docs/reviews/m1/procurement-outsourcing-m1-core-processing-po-design-amendment.md` | 完整路径 |

这四个提交**均已推送到 `github/master`**。N7 遍历 `anchor..HEAD` 的**全部**提交，后来的提交不能豁免早先提交的信息不合规 —— 唯一的传统修法是改写这些提交的**消息**，即改写**已发布历史**，需按 AGENTS.md §11.5 获得业务所有者对历史重写的明确批准，且会使既有 release tag 脱离分支祖先链。

## 2. 决定

引入**变更追溯台账**（`docs/acceptance/n7-traceability-ledger.md`）作为 N7 的**第二个「变更记录」来源**。

台账条目提供与提交信息**等价**的追溯凭据：提交 SHA + 受治理文件 + 章节 id + 所引用的所有者决定。**不删除、不跳过、不降低任何既有断言** —— 提交信息路径完全保留；台账只是把「变更记录」从「仅提交信息」扩展为「提交信息 **或** 已登记台账」。

### 2.1 窄口径合同

一个台账条目覆盖某个不合规提交，当且仅当**下列全部成立**：

1. **提交 SHA 精确相等** —— 完整 40 位十六进制，不接受短 SHA、不接受前缀匹配。
2. **受治理文件路径精确相等**。
3. **章节 id 集合与该提交在该文件上实际触达的章节集合完全相等** —— 多一个或少一个都不匹配；无法归属章节的变更（文件头 / 元数据 / 新增文件）要求条目的章节集合为**空**。
4. **引用的所有者决定文件存在**，且其元数据「状态」含 `APPROVED`。
5. **条目必须确实对应一个实际不合规提交** —— 不再对应的条目（提交已修复或消失）会被**报出并要求删除**，从而杜绝「预授权未来提交」。

### 2.2 不得豁免

- 受治理文件的**整体删除或移动**（原判定本就无豁免，台账不得介入）。
- **台账机制自身**：台账文件已登记为受治理文件，其自身的变更仍按普通规则追溯（提交信息必须含其完整路径或章节 id）。
- 章节 id 集合**不完全相等**的条目；引用**不存在或未批准**的决定的条目。

### 2.3 门禁化

- 台账解析、覆盖判定与失效检测的实现位于 `scripts/docs/lib/n7-traceability-ledger.mjs`（只读模块）。
- 判定接入点：`scripts/docs/check-doc-consistency.mjs` 的 N7。
- 回归测试：`scripts/docs/check-doc-consistency.test.js` 的 N7 对抗矩阵新增台账场景（精确匹配通过、章节 id 缺失仍失败、文件不符仍失败、失效条目被报出、决定未批准被拒）。
- 机器可验证入口：
  `node scripts/docs/check-doc-consistency.mjs --mode current --target HEAD`。

## 3. 为什么不用「改写已发布历史」

改写消息虽能根治，但代价是：① 四个提交的全部后代 hash 改变，需 force-push 到 `github/master` 与 Gitee `origin` 两个远端；② 任何已拉取该分支的人历史分叉；③ **既有 release tag 会脱离分支祖先链**（tag 本身不动，但不再是分支祖先），与 AGENTS.md §1「Git release tag 是发布身份权威」相抵触。台账方案在**不触碰任何已发布历史**的前提下达成同一治理目的。

## 4. 适用范围与撤销

- 本机制**只**适用于「提交信息不合规但变更本身可追溯」的历史提交。
- 它**不能**用于：让一个真正不合规的**未来**提交通过 —— 未来提交必须在自己的提交信息里写明路径或章节 id（否则仍判 FAIL，且无法登记台账条目，因为台账条目必须对应一个已存在的实际不合规提交）。
- 业务所有者可随时撤销本机制：删除台账文件与本决定记录即可，N7 立即回到原始判定。

## 5. 未授权事项

本记录**明确不授权**：任何 Implementation、发布、部署、push / merge / tag / Git 历史重写；任何对四个历史提交消息的改写。
