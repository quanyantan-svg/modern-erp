# M1C-G07-PARITY-R4 真实目录表达式括号的定向修复候审证据（2026-11-06）

> 用途：保存历史真实 Run `a78b0d3e-6919-4632-b2e4-5ee436da8d4b`（11 tests / 10 PASS / 1 FAIL）
> 的五张表目录表达式差异的真实根因、保义括号规范化实现、正反向测试证据，以及下一次真实
> MySQL Gate 的申请边界。
> Owner：Platform / Database Safety / QA（Parity 实施与证据维护）；Procurement &
> Outsourcing Domain Owner（Fixture 与 CR/Oracle 决定）。
> 状态：`PENDING_APPROVAL` —— 离线实施与验证已完成，真实 MySQL Gate 未重跑，历史
> G07=`FAIL` 与 `M1_CORE_ACCEPTANCE_BLOCKED` 保持不变。
> 第一轮独立源码复核结论 `M1C_G07_PARITY_R4_REVIEW_BLOCKED` 的两处 AST 确定性缺陷已由
> **R4-R1** 定向修复并复验（见 §8）；第二轮独立审查确认 R4-R1 两项均已关闭，另发现
> `parseCast()` **无条件丢弃字符集**，已由 **R4-R2** 定向修复并复验（见 §9）。
> 本候选据此重新进入待审状态。
> 权威来源：Requirement
> [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md)
> §31.13.5；Active Design
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md)
> §13.1；当前项目状态仅由 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 登记。
> 本文仅为实施/候审证据，不是新 Requirement 或 Design。

## 1. 基线与输入

- 实施基线：`master` @ `a8af67c0c5390fa1cf069282b0c024fac1df773e`。
- 历史真实 Run：`a78b0d3e-6919-4632-b2e4-5ee436da8d4b`，`11 tests / 10 PASS / 1 FAIL`，
  Cleanup/Postflight `PROVEN`，无 Quarantine，ACK-4 已消费且不可复用。
- 该 Run 的唯一失败断言：`real information_schema matches canonical SQLite schema`，
  失败表 **5 张**：`receipt_notice_item_sources`、`schedule_consumption_effects`、
  `outsourcing_wip_identity_effects`、`outsourcing_wip_identity_balances`（`CHECKS`）与
  `tracked_inventory_movements`（`GENERATED_COLUMN_EXPRESSION:__partial_6964656e74697479`）。
- 证据来源：上次 Run 的**脱敏结构证据块**（R3 新增的只读采集）与其 TAP stdout 原文，
  路径 `%LOCALAPPDATA%/ModernERP/mysql-gate/evidence/a78b0d3e-…/1793958244360-suite-5100.log`。
  **未使用任何人工构造的理想化字符串冒充真实导出。**
- 本轮未连接 MySQL、未执行 Reset / Bootstrap / Cleanup / Migration、未签发或消费 ACK-4、
  未执行真实 G07、未 Push / Merge / Tag / Release / Deploy。

## 2. 五张表的真实差异：前后对照

R3 已把 DEFAULT 类差异清零；剩余差异**同源**：MySQL 8.0.37 的目录渲染**给布尔表达式的
每一个操作数单独加括号**，并给整个子句与算术操作数加括号。

### 2.1 CHECKS（四张表，真实导出的原始子句）

| 表 | SQLite 规范表达式 | MySQL information_schema 原始表达式 |
|---|---|---|
| `receipt_notice_item_sources` | `allocated_quantity > 0` | `` (`allocated_quantity` > 0) `` |
| | `converted_quantity IS NULL OR (converted_quantity >= 0 AND converted_quantity <= allocated_quantity)` | `` ((`converted_quantity` is null) or ((`converted_quantity` >= 0) and (`converted_quantity` <= `allocated_quantity`))) `` |
| `schedule_consumption_effects` | `signed_quantity <> 0` | `` (`signed_quantity` <> 0) `` |
| | `effect_state IN ('EFFECTIVE','VOIDED')` | `` (`effect_state` in (_utf8mb4\'EFFECTIVE\',_utf8mb4\'VOIDED\')) `` |
| | `(signed_quantity > 0 AND reverses_effect_id IS NULL AND reverses_effect_key = '') OR (signed_quantity < 0 AND reverses_effect_id IS NOT NULL AND reverses_effect_key <> '')` | `` (((`signed_quantity` > 0) and (`reverses_effect_id` is null) and (`reverses_effect_key` = _utf8mb4\'\')) or ((`signed_quantity` < 0) and (`reverses_effect_id` is not null) and (`reverses_effect_key` <> _utf8mb4\'\'))) `` |
| `outsourcing_wip_identity_effects` | `identity_type IN ('LOT','SERIAL','NONE')` | `` (`identity_type` in (_utf8mb4\'LOT\',_utf8mb4\'SERIAL\',_utf8mb4\'NONE\'')) `` |
| | `effect_direction IN ('SUPPLY','CONSUME')` | `` (`effect_direction` in (_utf8mb4\'SUPPLY\',_utf8mb4\'CONSUME\')) `` |
| | `event_type IN ('ISSUE','SUPPLEMENT','TRANSFER_IN','RETURN','BACKFLUSH','TRANSFER_OUT')` | `` (`event_type` in (_utf8mb4\'ISSUE\',…)) `` |
| | `(identity_type='LOT' AND lot_id IS NOT NULL AND serial_id IS NULL) OR (identity_type='SERIAL' AND serial_id IS NOT NULL AND lot_id IS NULL) OR (identity_type='NONE' AND lot_id IS NULL AND serial_id IS NULL)` | `` (((`identity_type` = _utf8mb4\'LOT\') and (`lot_id` is not null) and (`serial_id` is null)) or ((`identity_type` = _utf8mb4\'SERIAL\') and …) or ((`identity_type` = _utf8mb4\'NONE\') and …)) `` |
| | `(effect_direction='SUPPLY' AND signed_quantity > 0) OR (effect_direction='CONSUME' AND signed_quantity < 0)` | `` (((`effect_direction` = _utf8mb4\'SUPPLY\') and (`signed_quantity` > 0)) or ((`effect_direction` = _utf8mb4\'CONSUME\') and (`signed_quantity` < 0))) `` |
| `outsourcing_wip_identity_balances` | `identity_type IN ('LOT','SERIAL','NONE')` | `` (`identity_type` in (_utf8mb4\'LOT\',…)) `` |
| | `evidence_state IN ('TRACKED','QUANTITY_ONLY')` | `` (`evidence_state` in (_utf8mb4\'TRACKED\',_utf8mb4\'QUANTITY_ONLY\')) `` |
| | `supplied_quantity >= 0` / `consumed_quantity >= 0` / `available_quantity >= 0` | `` (`supplied_quantity` >= 0) `` 等 |
| | `(identity_type='LOT' AND lot_id IS NOT NULL AND serial_id IS NULL AND evidence_state='TRACKED') OR …` | `` (((`identity_type` = _utf8mb4\'LOT\') and …) or …) `` |
| | `available_quantity = supplied_quantity - consumed_quantity` | `` (`available_quantity` = (`supplied_quantity` - `consumed_quantity`)) `` |

### 2.2 生成列表达式（`tracked_inventory_movements`）

| 侧 | 表达式 |
|---|---|
| SQLite 规范（生产 DDL 派生） | `CASE WHEN source_type IN ('OUTSOURCING_ISSUE',…) AND reversed=0 THEN SHA2(CONCAT_WS(CHAR(31),COALESCE(CAST(\`source_type\` AS CHAR),CHAR(30)),…),256) ELSE NULL END` |
| MySQL information_schema 原始 | `(case when ((`source_type` in (_utf8mb4\'OUTSOURCING_ISSUE\',…)) and (`reversed` = 0)) then sha2(concat_ws(char(31),coalesce(cast(`source_type` as char charset utf8mb4),char(30)),…),256) else NULL end)` |

### 2.3 逐项语义判定

- **业务谓词、字段、运算符、字面量值、生成列算法（SHA2 / CONCAT_WS / COALESCE / CHAR(31) /
  CHAR(30)）、partial predicate、字段引用**：两侧**完全一致**，逐字核对无差异。
- **唯一差异类别**：括号。MySQL 额外添加的**操作数括号**。
- 首个差异 token 位置与括号层级已逐例记录：例如
  `converted_quantity` 组合在 **token 0** 即出现 `SYMBOL:(`，嵌套深度 0；
  `signed_quantity` 三段组合在 **token 1** 出现 `SYMBOL:(`，嵌套深度 1（外层已由
  `unwrapOuterParentheses` 剥除）。
- ⇒ **不构成 BLOCKED**：全部差异均为**无语义影响的括号重写**。

## 3. 实施：保义括号规范化

### 3.1 做法

不新建第二套比较器：在**现有 token 层**之上增加一个**范围受限的表达式 AST**，
把 CHECK 与生成列表达式的比较改为**比较表达式树**，而不是比较 token 流。

- 词法层：`sqlExpressionTokenList()` 不变；CHECK 侧用 `sql_standard` 方言，MySQL 侧用
  `mysql_catalog` 方言（R3 已验证的真实目录约定）。
- 解析层：`parseExpressionTokens()` 覆盖本轮实际用到的结构 —— 布尔合成（OR / AND / NOT）、
  比较（`=` `<>` `<` `<=` `>` `>=`）、`IS [NOT] NULL`、`[NOT] IN`、`[NOT] BETWEEN`、
  `[NOT] LIKE`、算术（`+ - * / %`）、一元负号、字面量、标识符、函数调用、
  `CAST(x AS type)` 与 searched `CASE WHEN … THEN … [ELSE …] END`。
- 渲染层：`renderExpressionAst()` 输出 **S 表达式**，例如
  `a AND (b OR c)` → `(and (id a) (or (id b) (id c)))`。
  **树结构本身就是语义**：重新分组不可能渲染成同一形态。

### 3.2 为什么这不是「没有顶层 AND/OR 就删除括号」的通用规则

- 括号**不是**被正则删除，也不是被「顶层无布尔运算符就删」。
- 括号在**解析时被消耗**：解析器按 SQL 优先级建树，括号只影响建树，不再出现在渲染结果中。
  因此 `c AND (a OR b)` 的树是 `(and c (or a b))`，而 `(c AND a) OR b` 的树是
  `(or (and c a) b)` —— **两者永不相等**，优先级与结合关系由解析器保证。
- **无法识别的构造 fail closed**：`parseExpressionTokens()` 未能消费全部 token 时返回 `null`，
  `canonicalExpression()` 改用 `R:<token 流>` 形态。`R:` 与 `C:` 形态**互不相等**，
  故无法解析的表达式**只能与 token 流完全相同的另一个表达式相等**，
  且**永远不能与一个成功解析的表达式相等**。

### 3.3 保留与不变的语义

| 要求 | 实现 |
|---|---|
| 字符串字面量内容与大小写 | 字面量以 JSON 原样进入树，`(str "DRAFT")` 与 `(str "draft")` 不同；字面量**类别**亦进入树（`(str "1")` / `(num "1")` / `(null)`），由 R4-R1 补齐，见 §8 |
| charset 语义 | 目录侧的 `_utf8mb4` introducer 在词法层按方言解码；`CAST(x AS CHAR CHARSET utf8mb4)` 由既有的 `normalizeGeneratedCastCharset` 归一（两侧同时应用） |
| CAST 字符集 | 已批准的冗余 `charset utf8mb4` 与无 charset 子句等价；其它字符集名称（`latin1`、`ascii` 等）进入 AST，见 §9.2 |
| 标识符 | 沿用既有比较口径（词法层小写），未改变 |
| CASE WHEN / 函数参数 / 算术 / 比较 / IS NULL / IN / BETWEEN | 均在解析层有独立节点，未被折叠或丢弃 |
| 已验证成功的 DEFAULT 规范化 | **完全未改动**（`canonicalDefault()` / `canonicalSqliteDefault()` 无差异） |

### 3.4 修改的最小文件集合

| 文件 | 位置 | 变更 |
|---|---|---|
| `server/test-utils/m1-core-schema-parity.js` | `parseExpressionTokens()` / `renderExpressionAst()` / `canonicalExpression()`（新增） | 范围受限表达式 AST 与 S 表达式渲染 |
| `server/test-utils/m1-core-schema-parity.js` | `compareTableParity()` 的 CHECK 比较 | 改用 `canonicalExpression()`（两侧各自方言） |
| `server/test-utils/m1-core-schema-parity.js` | `compareTableParity()` 的生成列表达式比较 | 改用 `canonicalExpression()`（两侧各自方言 + 既有的 CAST charset 归一） |
| `server/test-utils/m1-core-schema-parity.js` | `generatedExpression()` | 改为导出（供测试取生产派生的预期表达式） |
| `server/m1-core-g07-infrastructure.test.js` | 新增 7 个 R4 测试 + 真实夹具与离线回放辅助 | 见 §4 |

**未改动**：生产 Handler、DDL、Migration、Fixture、已批准 digest、CR-01～CR-09、
Supplemental Oracle、ACK-4 安全合同、已验证成功的 DEFAULT 规范化规则。

**生产 DDL 未变**：645 条语句，SHA-256 `bc56b56a28d515ffacfa22c658c126f589f3ee0812240ba0e9ea88f2494c4688`
（改前 = 改后）。

## 4. 正向与负向测试

新增于 `server/m1-core-g07-infrastructure.test.js`（已注册文件，未新增未分类测试文件）：

**正向**

1. 四张真实失败表的**真实导出原始子句**与规范 SQLite 子句逐条规范形相等。
2. 真实导出的生成列表达式与生产派生表达式规范形相等（`CASE WHEN` + digest）。
3. `allocated_quantity > 0` 原子比较括号、`converted_quantity` 的 NULL/范围组合、
   `effect_direction` 的 SUPPLY/CONSUME 组合、`available_quantity = supplied_quantity - consumed_quantity`
   的算术括号，均与真实导出形式规范形相等。
4. **16 张 Parity 表的离线回放全部通过**：MySQL 侧由**生产自身发出的 DDL** 构造，
   五张表叠加**上次真实 Run 导出的原始目录输出**。

**负向（全部仍必须失败）**

| 负控 | 断言 |
|---|---|
| AND/OR 分组语义改变 | `a AND (b OR c)` ≠ `(a AND b) OR c`（并固定两种树形） |
| NOT 作用范围改变 | `NOT (a AND b)` ≠ `NOT a AND b`；`NOT (a OR b)` ≠ `NOT a OR b` |
| 算术优先级改变 | `a = b + c * d` ≠ `a = (b + c) * d`；`a = b * c + d` ≠ `a = b * (c + d)` |
| 比较运算符改变 | `a > 0` ≠ `a >= 0`；`a <> 0` ≠ `a != 0` |
| CHECK 成员缺失或增加 | `CHECKS` |
| `CHECK_NOT_ENFORCED` | `CHECK_NOT_ENFORCED` |
| 字符串大小写改变 | `CHECKS` |
| 字符串值改变 | `CHECKS` |
| 谓词改变（NOT IN） | `CHECKS` |
| 生成列 partial predicate 改变 | `GENERATED_COLUMN_EXPRESSION` |
| 生成列 SHA2 / CONCAT_WS / COALESCE / 字段引用 / 分隔符改变 | `GENERATED_COLUMN_EXPRESSION` |
| 无法识别的构造 | 拒绝（`R:` 形态），只能与自身相等，绝不与已解析表达式相等 |

既有负控（缺列 `COLUMN_SEQUENCE`、缺 UNIQUE `UNIQUE_MISSING`、缺 CHECK、错误 default、
`CHECK_NOT_ENFORCED`、生成列 kind / expression / `INDEX_COLUMNS` / `UNIQUE_MISSING`、
外键查询必须绑定当前表）全部保持通过。

## 5. 离线复验与门禁

本节记录 **R4 轮**的离线复验结果；R4-R1 修复后的复验见 §8.4。

| 项 | 结果 |
|---|---|
| 真实日志接地的 16 表离线回放 | **16/16 PASS**，其中 **5 张表**使用上次真实 Run 导出的原始目录输出，其余 11 张使用生产自身 DDL |
| R3 focused（隔离环境） | **65/65 PASS** |
| FAST | **571/571 PASS**，0 fail / 0 skipped / 0 todo |
| Build | PASS |
| Node `--check` | PASS |
| `git diff --check` | PASS |
| docs current / migration | **ALL CHECKS PASSED** |
| Fixture digest 重算 | `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091`（= 批准值，不变） |
| 生产 DDL 指纹 | 645 条语句，SHA-256 `bc56b56a…c4688`（不变） |

## 6. 仍存在的不确定性

1. **解析器是范围受限的**：只覆盖本轮实际用到的 CHECK 与生成列结构。下一次真实 Gate 若
   出现范围外的构造（例如 `MATCH ... AGAINST`、窗口函数、复杂 `CASE` 简单形式），
   该表达式会被**拒绝**（`R:` 形态）并**保守失败**，而不会被误判为相等。
   R3 新增的结构证据采集会同时给出该表达式的原始文本，届时按同一方式做一次定向扩展即可。
2. **其余 11 张表的 CHECK 原始目录输出未被采集**（上次 Run 它们未失败，因而未进入证据块）。
   它们在生产派生的渲染下已经相等；其真实渲染仍未被逐字观测，但它们在本轮**不产生差异**。
3. **表达式树取代 token 流比较**后，差异判定的严格性从「字符级」变为「结构级」：
   括号差异被归一，**结构、运算符、字面量、字段、字面量大小写仍然逐项比对**。
   归一的前提是解析器按 SQL 优先级建树；该行为已由 §4 的负向对照逐条固定。
4. **未重跑真实 G07**：本轮全部为离线验证。历史 G07 仍为 `FAIL`，
   `M1_CORE_ACCEPTANCE_BLOCKED` 保持。

## 7. 候审结论

```text
M1C_G07_PARITY_R4_R2_IMPLEMENTED_READY_FOR_INDEPENDENT_REVIEW
```

R4 的实现方向经两轮独立源码复核通过；第一轮提出的两处 AST 确定性缺陷（A 字面量类别丢失、
B CAST 长度丢失）已由 R4-R1 定向修复并复验（见 §8），第二轮发现的 `parseCast()` 无条件
丢弃字符集已由 R4-R2 定向修复并复验（见 §9）。

历史 G07 仍为 `FAIL`，`M1_CORE_ACCEPTANCE_BLOCKED` 保持不变；本轮不签发 G07 PASS、
M1-Core Acceptance、Freeze、Domain Closure 或 Release Readiness。下一次真实 MySQL Gate
须另行申请新的 Run ID 与新的 commit SHA。

## 8. 独立源码复核结论与 R4-R1 定向修复

### 8.1 复核结论

独立源码复核候审提交 `ffbb0e81be8923343b5d8d0d2b059f493e3eecb2`，结论：

```text
M1C_G07_PARITY_R4_REVIEW_BLOCKED
```

R4 的整体方向（以表达式树取代 token 流比较）通过；阻塞项为 AST 解析器中两处
**会误判表达式等价**的确定性缺陷。二者只影响比较器的严格性，不涉及生产代码、
Fixture、DDL、Migration 与已批准 digest。

| 编号 | 缺陷 | 误判 | R4-R1 修复 |
|---|---|---|---|
| A | 字面量**类别**丢失：字符串 Token 与数值 Token 都生成 `kind=lit` 且 `value` 为字符串 | `status='1'` 与 `status=1` 渲染成同一形态；`x='0'` 与 `x=0` 同理；IN 列表同样合并 | 字面量类别进入 AST：`str` / `num` / `null` 三类节点，渲染分别为 `(str …)` / `(num …)` / `(null)` |
| B | `parseCast()` 读取类型长度后**未保存** | `CAST(x AS CHAR(8))` 与 `CAST(x AS CHAR(64))` 渲染相同；`CAST(x AS CHAR)` 与 `CAST(x AS CHAR(8))` 也相同 | 类型参数（长度、精度、标度）逐项保存在 AST 并进入规范形；无参数与有参数的渲染不同 |

### 8.2 修复边界

- **只改比较器与负向测试**：`server/test-utils/m1-core-schema-parity.js` 的
  `parseExpressionTokens()` / `renderExpressionAst()`，以及
  `server/m1-core-g07-infrastructure.test.js` 新增的 3 个 R4-R1 负向测试。
- **未重写 R4 AST**：解析范围、括号在解析时被消耗、优先级建树、`R:` fail closed 形态、
  既有 `normalizeGeneratedCastCharset` 归一规则**全部保持不变**。
- **未引入新的无依据等价规则**：字面量类别与 CAST 参数只会让比较**更严格**，不会让任何
  两个此前不相等的表达式变得相等。
- **既有的等价规则保留**：R3/R4 已证明的 MySQL 目录 charset 表示等价（两侧同时应用的
  `normalizeGeneratedCastCharset`）与 `parseCast()` 对 `CHAR … CHARSET utf8mb4` 的既有
  消费逻辑**均未改动**；字面量内容的大小写显著性**未改动**。

### 8.3 新增负向控制

| 负控 | 断言 |
|---|---|
| 字符串字面量与数值字面量文本相同 | `status='1'` ≠ `status=1`；`x='0'` ≠ `x=0`；`x='01'` ≠ `x=1` |
| 字符串大小写 | `s='DRAFT'` ≠ `s='draft'`（继续失败） |
| IN 列表不合并字符串与数值 | `s IN ('1')` ≠ `s IN (1)`；`s IN ('1','2')` ≠ `s IN (1,2)` |
| 目录方言同样不合并 | `(_utf8mb4\'1\' = \`x\`)` ≠ `(1 = \`x\`)` |
| NULL 是字面量 | `x = NULL` ≠ `x = 'NULL'` |
| CAST 长度 | `CAST(x AS CHAR(8))` ≠ `CAST(x AS CHAR(64))` |
| CAST 无长度与有长度 | `CAST(x AS CHAR)` ≠ `CAST(x AS CHAR(8))` |
| CAST 精度与标度 | `CAST(x AS DECIMAL(10,2))` ≠ `CAST(x AS DECIMAL(10,3))` / `DECIMAL(12,2)` |
| 生成列 digest 的 CAST 长度改变 | `GENERATED_COLUMN_EXPRESSION` |

三项新测试在**修复前**（比较器回退到 `ffbb0e8`）实测全部 FAIL，修复后全部 PASS；
既有 41 项测试在两个版本下均 PASS。

### 8.4 修复后的离线复验

| 项 | 结果 |
|---|---|
| 四张真实失败表的原始目录子句逐条规范形相等 | **PASS** |
| 真实导出的生成列表达式与生产派生表达式相等 | **PASS** |
| 16 张 Parity 表离线回放（其中 5 张使用真实 Run 导出的原始目录输出） | **16/16 PASS** |
| AND/OR 分组、NOT 作用范围、算术优先级、比较运算符负控 | **PASS**（既有 R4 负控未变） |
| DEFAULT 规范化 | **完全不变**：修复前后 256 组 `canonicalDefault()` / `canonicalSqliteDefault()` 规范形逐组相同（差异 0），`sqlExpressionTokens()` 输出不变 |
| 生产 DDL 指纹 | **不变**：645 条语句，SHA-256 `bc56b56a28d515ffacfa22c658c126f589f3ee0812240ba0e9ea88f2494c4688`（与 R3/R4 基线逐字节相同） |
| Fixture digest 重算 | `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091`（= 批准值，不变） |
| Focused（`server/m1-core-g07-infrastructure.test.js`） | **44/44 PASS**（R4 的 41 项 + R4-R1 的 3 项） |
| FAST | **574/574 PASS**，0 fail / 0 skipped / 0 todo |
| Build | PASS |
| Node `--check` | PASS |
| `git diff --check` | PASS |

### 8.5 未发生

未运行真实 MySQL G07；未签发或消费 ACK-4；未执行 Reset / Bootstrap / Cleanup / Migration；
未修改生产 Handler、DDL、Migration、Fixture、已批准 digest、CR-01～CR-09、Supplemental Oracle；
未复用历史 Run ID；未 Force Push；未推送 master；未 Merge / Tag / Release / Deploy。
仅按授权将修复提交 Fast-forward 推送至原 R4 审查分支
`review/m1c-g07-parity-r4-20261106`。

## 9. 第二轮独立审查结论与 R4-R2 严格性补丁

### 9.1 审查结论

独立审查提交 `53ebf0cf1d1fb58b64b2c9083c34b530ecc2e649` 确认：R4-R1 的两项阻塞
（字面量类别、CAST 类型参数）**均已关闭**。新增发现一项：

> `parseCast()` 读取**任意** CHARSET 后直接丢弃，可能将 `utf8mb4` 与 `latin1` 的不同
> CAST 表达式误判为相同。

### 9.2 修复方式

只改 `parseCast()` 的字符集处理与 `renderExpressionAst()` 的 `cast` 分支，**不重写 AST**。

| 字符集 | 规范形 | 依据 |
|---|---|---|
| 无 charset 子句 | `(cast (id x) char)` | 基准形态 |
| `CHARSET utf8mb4` / `CHARACTER SET utf8mb4` | `(cast (id x) char)` | **已批准**：MySQL 目录在未写明目标字符集时冗余地标出连接字符集，与无 charset 子句等价 |
| `CHARSET latin1` / `ascii` / 其它 | `(cast (id x) char charset latin1)` | 字符集影响 CAST 的产出，必须进入 AST，**不得无条件丢弃** |

- 采用**保留字符集名称进 AST**而非安全拒绝：安全拒绝会使含该字符集的**整个** CHECK 子句
  退化为 token 流比较，而 MySQL 目录会给布尔操作数加括号，结构等价的对将因括号差异被
  误判为不等。保留名称可同时满足「不误判相等」与「不引入误判不等」。
- 词法层既有的 `normalizeGeneratedCastCharset` 归一（两侧同时应用，仅剥离 `char` 之后的
  `charset utf8mb4`）**未改动**，与 AST 层规则相互一致、互为冗余。
- 未引入任何新的无依据等价规则：非 `utf8mb4` 字符集只会让比较**更严格**。

### 9.3 新增负向控制

| 负控 | 断言 |
|---|---|
| 已批准的冗余字符集保持等价 | `CAST(x AS CHAR)` ≡ `CAST(x AS CHAR CHARSET utf8mb4)` ≡ `CAST(x AS CHAR CHARACTER SET utf8mb4)` |
| 未批准字符集不得被合并 | `CHARSET utf8mb4` ≠ `CHARSET latin1`；≠ `CHARSET ascii`；`latin1` ≠ `ascii` |
| 无字符集与未批准字符集 | `CAST(x AS CHAR)` ≠ `CAST(x AS CHAR CHARSET latin1)` / `ascii` |
| 带长度时的字符集 | `CAST(x AS CHAR(8) CHARSET utf8mb4)` ≠ `CAST(x AS CHAR(8) CHARSET latin1)` |
| 生成列 digest 的错误字符集 | `GENERATED_COLUMN_EXPRESSION`（latin1 与 ascii 均触发） |
| 生成列 digest 的已批准字符集 | 仍判为相等（不产生差异） |

两项新测试在**修复前**（比较器回退到 `53ebf0c`）实测全部 FAIL，修复后全部 PASS；
既有 44 项测试在两个版本下均 PASS。

### 9.4 修复后的回归复验

| 项 | 结果 |
|---|---|
| 四张真实失败表的原始目录子句逐条规范形相等 | **PASS** |
| 真实导出的生成列表达式与生产派生表达式相等 | **PASS** |
| 16 张 Parity 表离线回放 | **16/16 PASS** |
| 既有 44 项 focused 测试（DEFAULT、字面量类别、CAST 长度与参数、AND/OR、NOT、算术优先级、比较运算符、CHECK 与生成列负控） | **全部不回退** |
| DEFAULT 规范化 | **完全不变**：修复前后 224 组 `canonicalDefault()` / `canonicalSqliteDefault()` 规范形逐组相同（差异 0），`sqlExpressionTokens()` 输出不变 |
| 生产 DDL 指纹 | **不变**：645 条语句，SHA-256 `bc56b56a28d515ffacfa22c658c126f589f3ee0812240ba0e9ea88f2494c4688` |
| Fixture digest 重算 | `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091`（= 批准值，不变） |
| Focused（`server/m1-core-g07-infrastructure.test.js`） | **46/46 PASS**（44 + R4-R2 的 2 项） |
| FAST | **576/576 PASS**，0 fail / 0 skipped / 0 todo |
| Build | PASS |
| Node `--check` | PASS |
| `git diff --check` | PASS |

### 9.5 未发生

未运行真实 MySQL G07；未签发或消费 ACK-4；未执行 Reset / Bootstrap / Cleanup / Migration；
未修改生产 Handler、DDL、Migration、Fixture、已批准 digest、CR-01～CR-09、Supplemental Oracle；
未复用历史 Run ID；未 Force Push；未推送 master；未 Merge / Tag / Release / Deploy。
仅按授权将修复提交 Fast-forward 推送至原 R4 审查分支
`review/m1c-g07-parity-r4-20261106`。
