# M1C-G07-PARITY-R3 Schema Parity 定向修复候审证据（2026-11-06）

> 用途：保存历史真实 Run `df0202b6-a44f-44c5-88df-305f43cf7dfa`（11 tests / 10 PASS / 1 FAIL）
> 的 Schema Parity 单一失败的根因定位、最小离线修复、正向与负向测试证据，以及下一次
> 真实 MySQL Gate 的申请边界。
> Owner：Platform / Database Safety / QA（Parity 实施与证据维护）；Procurement &
> Outsourcing Domain Owner（Fixture 与 CR/Oracle 决定）。
> 状态：`PENDING_APPROVAL` —— 离线实施与验证已完成，真实 MySQL Gate 未重跑，历史
> G07=`FAIL` 与 `M1_CORE_ACCEPTANCE_BLOCKED` 保持不变。
> 权威来源：Requirement
> [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md)
> §31.13.5；Active Design
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)
> §13.1；当前项目状态仅由 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 登记。
> 本文仅为实施/候审证据，不是新 Requirement 或 Design。

## 1. 基线与输入

- 实施基线：`master` @ `9b2afc173e607285b74790f4eaa22c79e77beb36`。
- 历史真实 Run：`df0202b6-a44f-44c5-88df-305f43cf7dfa`，`11 tests / 10 PASS / 1 FAIL`，
  Cleanup/Postflight `PROVEN`，无 Quarantine，ACK-4 已消费且不可复用。
- 该 Run 的唯一失败断言：`real information_schema matches canonical SQLite schema`
  → `M1_SCHEMA_PARITY_MISMATCH`，涉及 14 张表、4 类差异。
- 已批准 Fixture digest `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091`
  **本轮未改动**，CR-01～CR-09 与 Supplemental Oracle **未改动**。
- 本轮未连接 MySQL 写入路径，未执行 Reset / Bootstrap / Cleanup / Migration，未签发或
  消费 ACK-4，未执行真实 G07，未 Push / Merge / Tag / Release / Deploy。

## 2. 四类差异的精确根因

### 2.1 统一根因：比较器按 SQL 标准方言解码 MySQL 目录元数据

MySQL 8.0.37 的**目录渲染**（catalogue rendering）把字符串字面量的定界符本身用反斜杠
转义，并在其前加字符集 introducer。本机只读观测（live MySQL 8.0.37，`mysql.engine_cost.default_value`
的真实生成列）：

```text
(case `cost_name` when _utf8mb4\'io_block_read_cost\' then 1.0 ... else NULL end)
```

即：标识符用普通反引号，**字符串字面量用 `\'` 定界，并带 `_utf8mb4` introducer**。
本仓库 §37.48 已在 Wave 10 战役中就 `information_schema.CHECK_CONSTRAINTS.CHECK_CLAUSE`
记录了同一约定（`CHECK_LITERAL_DIALECT.MYSQL_CATALOG`，见
`server/test-utils/wave10-mysql-schema-fixture.js`）。**M1-Core Parity 比较器自行重写了一套
不认识该约定的分词器**，于是四类差异同源。

### 2.2 逐类根因与证据

| 差异类 | 根因 | 证据 | 状态 |
|---|---|---|---|
| `DEFAULT`（10 表） | 生产对 LONGTEXT/JSON 列发出**表达式默认值** `DEFAULT ('EA')`；MySQL 目录把该表达式渲染为 `(\'EA\')`。比较器用 SQL 标准引号解码，得到 `STRING:\'EA\'` 而非 `STRING:EA` | 由真实失败集合**反证**：只有「字面量默认值报裸值、表达式默认值报转义字面量」这一条候选能 **16/16 精确复现**历史失败集合（`NULL`/`EXPRESSION_TEXT`/`BARE_LITERAL`/`QUOTED_LITERAL` 四条候选均不能复现） | 强证据（排除法）；原始 `COLUMN_DEFAULT` 值待下一次 Gate 直接采集 |
| `CHECKS`（10 表） | MySQL 的 `CHECK_CLAUSE` 用 `\'` 定界字面量；比较器用 SQL 标准分词器读取，`\'` 被拆成 `CHAR:\` + 半截字面量 | 仓库 §37.48 已由受保护战役证明同一约定 | **已证实** |
| `GENERATED_COLUMN_EXPRESSION`（2 表） | digest 生成列的 `GENERATION_EXPRESSION` 内含字符串字面量（partial 谓词与 `COALESCE(lot_id,'')`），按同一目录约定渲染为 `\'` | 同上（live 生成列实测） | **已证实** |
| `GENERATED_COLUMN_MISSING` + `INDEX_COLUMNS`（`inventory_valuation_movements`） | 比较器的 `requiresGeneratedDigest()` 与生产 `bootstrapMySql()` 的 `useDigest` **规则不一致**：比较器把「列数 > 4」当作 digest 条件，生产只对 **UNIQUE** 索引如此。`idx_valuation_movements_identity_status_created` 是**非唯一**七列普通索引，生产走普通物理索引路径，比较器却要求 `__partial_*` 生成列 | 生产 DDL 实测：该索引发出 `CREATE INDEX ... (\`product_id\`,...,\`status\`(16),\`created_at\`(64),\`id\`)`，无生成列 | **已证实** |

### 2.3 §37.46 的等价处理为何未生效

§37.46 曾针对「default 字面量 / autoindex 名 / CHECK introducer / 生成列差异」收紧过比较器，
但其等价处理落在**离线比较方向**；真实 Gate 失败的是**实时 MySQL vs 规范 SQLite**方向，
该方向对表达式默认值与目录字面量约定没有对应规则，因此同一批 14 张表仍然全量失败。

## 3. 真实缺陷与表示差异分类

| 表 | 历史失败差异 | 分类 |
|---|---|---|
| `receipt_notice_item_sources` | `DEFAULT:source_trace_json` | `REPRESENTATION` |
| `schedule_consumption_effects` | `CHECKS` | `REPRESENTATION` |
| `outsourcing_orders` | `DEFAULT:unit`、`DEFAULT:remark`、`CHECKS` | `REPRESENTATION` |
| `outsourcing_material_list` | `DEFAULT:identity_evidence_state` | `REPRESENTATION` |
| `outsourcing_receipts` | `DEFAULT:business_status` | `REPRESENTATION` |
| `outsourcing_receipt_items` | `DEFAULT:unit_code` | `REPRESENTATION` |
| `outsourcing_wip_identity_effects` / `_allocations` / `_balances` | `CHECKS` | `REPRESENTATION` |
| `tracked_inventory_movements` | `GENERATED_COLUMN_EXPRESSION:__partial_6964656e74697479`、`CHECKS` | `APPROVED_PHYSICAL`（digest 生成列）+ `REPRESENTATION` |
| `inventory_transactions` | `DEFAULT:source_no`、`DEFAULT:remark`、`DEFAULT:valuation_status`、`CHECKS` | `REPRESENTATION` |
| `inventory_valuation_movements` | `GENERATED_COLUMN_MISSING:__partial_5f63726561746564`、`GENERATED_COLUMN_EXPRESSION:__partial_6964656e74697479`、`INDEX_COLUMNS:idx_valuation_movements_identity_status_created`、`CHECKS` | 前两项 `APPROVED_PHYSICAL`；`INDEX_COLUMNS` 为**比较器规则错误**；`CHECKS` `REPRESENTATION` |
| `purchase_orders` | 7 项 `DEFAULT`、`CHECKS` | `REPRESENTATION` |
| `purchase_receipts` | `DEFAULT:remark`、`DEFAULT:billing_mode`、`CHECKS` | `REPRESENTATION` |

**`REAL_DEFECT = NONE`**：逐表逐项核对后，**未发现缺列、缺 UNIQUE、缺 CHECK、错误 default、
错误谓词或错误生成表达式**。

**Owner §1 要求的「生产把非唯一表达式索引错误实现为 UNIQUE」检查：未发现该情形。**
本 Parity 集合内带表达式的索引（`idx_valuation_source_identity`、
`uq_tracked_outsourcing_identity`、`uq_tracked_post`）**全部为 UNIQUE**；唯一被比较器误判为
digest 的 `idx_valuation_movements_identity_status_created` 既非唯一也无表达式，生产以普通
非唯一物理索引实现，两侧语义一致。因此无需上报真实物理 Schema 问题。

## 4. 最小修改集合与代码位置

| 文件 | 位置 | 变更 |
|---|---|---|
| `server/database/mysql-schema.js` | `usesGeneratedDigest(index)`（新增导出，紧邻 `hasExpressionColumns`） | 抽出**唯一**的索引物理实现计划规则：表达式列 → digest；UNIQUE 且 partial → digest；UNIQUE 且列数 > 4 → digest；普通非唯一多列索引 → 普通物理索引 |
| `server/database/mysql-schema.js` | `bootstrapMySql()` 的索引循环 | 改用 `usesGeneratedDigest(index)`，取代内联的同形表达式 |
| `server/test-utils/m1-core-schema-parity.js` | 删除本地 `requiresGeneratedDigest()` | 改为 import 生产 `usesGeneratedDigest`，比较器与生成器不再可能分叉 |
| `server/test-utils/m1-core-schema-parity.js` | `M1_CORE_SQL_LITERAL_DIALECT`、`readLiteralToken()`、`sqlExpressionTokenList()` / `sqlExpressionTokens()` | 新增**方言感知**分词器：`sql_standard`（SQLite DDL 与生产 DDL，`''` 为字面量引号）与 `mysql_catalog`（实时目录，`\'` 为字面量定界符）；字面量**大小写保持显著**；字面量内反斜杠一律拒绝并给出可区分形态；SQL 标准方言的 `''` 合并规则保留，目录方言**不合并**相邻字面量 |
| `server/test-utils/m1-core-schema-parity.js` | `canonicalDefault()` / `canonicalSqliteDefault()` | 新增统一默认值规范形：`NONE`（无默认）/ `EMPTY`（空字符串）/ `STRING:<json>`（文本，大小写显著）/ `NUMBER:<n>`（数值）/ `KEYWORD:<kw>`（日历关键字）/ `EXPR:<tokens>`（表达式）。NULL 与空字符串、字符串 `"0"` 与数字 `0`、`'DRAFT'` 与 `'POSTED'`、常量与动态表达式**保持可区分** |
| `server/test-utils/m1-core-schema-parity.js` | `compareTableParity()` | CHECK 比较：SQLite 侧 `sql_standard`、MySQL 侧 `mysql_catalog`；生成列表达式比较：期望侧 `sql_standard`、实际侧 `mysql_catalog`；默认值比较改用上述规范形 |
| `server/test-utils/m1-core-schema-parity.js` | `describeM1CoreStructuralDifference()`（新增导出）、`assertM1CoreInformationSchemaParity()` | 失败时附**脱敏只读结构差异证据**：失败列的原始 `COLUMN_DEFAULT` / `EXTRA` / `DATA_TYPE`、原始 `CHECK_CLAUSE` / `ENFORCED`、原始 `GENERATION_EXPRESSION`、原始索引行。仅为 schema 元数据，不含行数据、凭据或 Token |
| `server/m1-core-g07-infrastructure.test.js` | 新增 4 个测试 | 见 §5 |

**生产 DDL 未变**：把 `bootstrapMySql` 改用共享规则前后，生产对规范快照发出的全部 DDL
**逐字节相同** —— 645 条语句，SHA-256 `bc56b56a28d515ffacfa22c658c126f589f3ee0812240ba0e9ea88f2494c4688`
（改前 = 改后）。

**未改动**：生产业务 Handler、Fixture、已批准 digest、业务 SQL/DDL/Migration、CR/Oracle 断言。

## 5. 正向与负向测试

新增于 `server/m1-core-g07-infrastructure.test.js`（已注册文件，未新增未分类测试文件）：

1. **正向（真实形状）** —— `idx_valuation_movements_identity_status_created` 的真实形状
   （七个普通列、非唯一、无 partial 谓词、无表达式）：断言 `usesGeneratedDigest()` 为 `false`，
   且比较器接受其**真实有序列**，不要求任何 `__partial_*`。
2. **负向** —— 同一形状下：缺列 → `INDEX_COLUMNS`；列顺序错误 → `INDEX_COLUMNS`；
   UNIQUE 属性错误 → `INDEX_UNIQUE`。
3. **正向（目录渲染）** —— MySQL 目录形态的表达式默认值 `(\'DRAFT\')`（`EXTRA=DEFAULT_GENERATED`）
   与 CHECK 子句 `(\`status\` in (_utf8mb4\'DRAFT\',_utf8mb4\'POSTED\'))` 与规范 SQLite 字面量比较相等。
4. **负向（默认值区分）** —— 无默认 ≠ 空字符串默认；不同空字符串默认失败；`'0'` ≠ `'1'`；
   数值默认 `0` ≠ `1`；动态表达式 ≠ 常量；文本 `'0'` ≠ 数值表达式 `0`。

既有负向测试保持通过：缺列 `COLUMN_SEQUENCE`、缺 UNIQUE `UNIQUE_MISSING`、缺 CHECK `CHECKS`、
错误 default `DEFAULT:status`、`CHECK_NOT_ENFORCED`、业务字面量**大小写**变化必须失败
（`_utf8mb4'draft'` vs `_utf8mb4'DRAFT'`）、生成列 `GENERATED_COLUMN_KIND` /
`GENERATED_COLUMN_EXPRESSION` / `INDEX_COLUMNS` / `UNIQUE_MISSING`。

### 离线端到端复算

以**生产自身发出的 DDL**（录音适配器驱动 `bootstrapMySql`）+ **本机只读观测到的 MySQL 8.0.37
目录渲染规则**构造 16 张表的 MySQL 侧合同，调用**真实导出比较器**
`compareTableParity()`：**16/16 PASS，0 差异**。

## 6. 未发生 / 未授权事项

- 未执行真实 G07、Reset、Bootstrap、Cleanup、Migration；未签发或消费 ACK-4；未复用已消费 Run ID。
- 未用测试账号创建临时 Schema；未改动生产实例、账号或授权集。
- 未修改仓库业务代码；未 Push / Merge / Tag / Release / Deploy；未自动重试。
- §6 的 `scripts/gates/issue-mysql-ack4.ps1` 缺少 `System.Security` 加载（PowerShell 5.1 下
  `TypeNotFound: [Security.Cryptography.ProtectedData]`）**本轮只提出、不实施**：建议与
  `run-mysql-local-gate.ps1` 一致地补一行
  `try { Add-Type -AssemblyName System.Security -ErrorAction Stop } catch { }`。
  该修复与 G07 范围无关，需 Owner 批准后另行实施。

## 7. 尚待直接证实的项与下一次 Gate 的建议

- **待直接证实**：MySQL 目录对**表达式默认值**的原始 `COLUMN_DEFAULT` 文本。本机当前无任何
  表达式默认值列（只读观测：`DEFAULT_GENERATED` 列仅有 `CURRENT_TIMESTAMP` 形态），历史
  日志只含差异代码而无原始值，故该条以**排除法强证据**成立，仍需下一次 Gate 直接采集。
  为此已在失败路径加入脱敏结构证据采集（§4 最后一行），下一次 Gate 会直接给出原始值。
- **建议的下一次真实 Gate**：沿用既有授权形态（一次性 ACK-4、四操作按序、Cleanup 证明），
  换用**新的** Run ID 与新的 commit SHA。若 `DEFAULT` 的原始渲染与本轮假设不符，
  新增的结构证据采集会给出原始值，从而**不再需要**一次盲跑。

## 8. 候审结论

```text
M1C_G07_PARITY_R3_IMPLEMENTED_READY_FOR_INDEPENDENT_REVIEW
```

历史 G07 仍为 `FAIL`，`M1_CORE_ACCEPTANCE_BLOCKED` 保持不变；本轮不签发 G07 PASS、
M1-Core Acceptance、Freeze、Domain Closure 或 Release Readiness。

## 9. 独立复核发现与修复（2026-11-06）

- **独立复核基线**：`0b7cf2fe5b05bf292a5cb143c43ac748f5e35a68`，结论
  `M1C_G07_PARITY_R3_REVIEW_BLOCKED`：发现一处**与 Parity 方言修复无关的确定性回归**。
- **回归内容**：R3 重写 `readMySqlInformationSchemaContract()` 时，外键查询丢失了当前表范围
  条件 `k.TABLE_NAME=?`。该条件在 GitHub 原基线 `9b2afc17` 中存在，属**意外删除**。
  未恢复时，`information_schema.KEY_COLUMN_USAGE` 会把全库其他表的外键读入目标表合同，
  造成 `FOREIGN_KEYS` 失败。
- **修复**：外键查询恢复为
  `WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL`，
  绑定调用保持 `.all(tableName)`。仅此一处，未扩大范围。
- **回归测试**：`server/m1-core-g07-infrastructure.test.js` 新增「外键查询保持绑定到被请求的表」，
  断言查询含 `k.TABLE_SCHEMA=DATABASE()`、含 `k.TABLE_NAME=?`、**恰有一个**绑定占位符、
  绑定值等于传入的 `tableName`，并用**两个不同表名**复验以排除误用固定表名。
  该测试**不使用**无条件返回预设外键数组的 Mock 来代替绑定验证，而是从查询文本与实际绑定参数取证。
  已验证其**在回归存在时必然失败**（移除修复后该用例 FAIL），修复后 PASS。
- **不变项复核**：R3 的目录字面量解析不变（离线端到端复算仍 **16/16 表 PASS**）；
  DEFAULT、CHECK、生成列负控保持通过；CR-01～CR-09（9）与 Supplemental Oracle（7）不变；
  Fixture digest `9816affb…d71091` 不变；**生产 DDL 不变**（645 条语句，SHA-256 `bc56b56a…c4688`）。
- **复验结果**：R3 focused `58/58 PASS`；FAST `564/564 PASS`，0 fail / 0 skipped / 0 todo；
  Build PASS；Node `--check` PASS；`git diff --check` PASS；docs current 与 migration PASS。
- **未发生**：未改 issuer、生产 Handler、Schema、Migration、Fixture 或 Oracle；未运行 MySQL Gate、
  Reset、Bootstrap、Cleanup；未签发 ACK-4；未复用历史 Run ID；未 Force Push；未推送 master。
