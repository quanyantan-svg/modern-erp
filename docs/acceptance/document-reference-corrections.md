# 历史引用纠错登记（`DOC-REF-CORR-01`）

> 状态：`ACTIVE`
> Owner：Platform
> 用途：登记 append-only 历史文档（如 `log/` 目录下的开发日志）中**已经写下的**失效相对链接的精确纠错证据，使 current 文档检查器能够在**不改写历史原文**的前提下，把「已登记且仍然成立」的断链判为 `CORRECTED_REFERENCE`，其余断链继续 fail closed。
> 权威来源：本文件是 `scripts/docs/check-doc-consistency.mjs` 的 **N1 输入证据**，供 `scripts/docs/lib/reference-corrections.mjs` 解析。本文件**不是**第二份项目状态登记表，**不构成**任何 Acceptance / Capability Freeze 结论，**不**替代 [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md)。
> 依据：Requirement [`docs/requirements/platform.md` §36.16.7](../requirements/platform.md)（`PL-RI-06`）；Design [`docs/design/platform.md` §32.16.8](../design/platform.md)。

## DOC-REF-CORR-01 纠错登记

| 纠错 ID | 原文件 | 原行内容哈希 | 错误目标 | 正确目标 | 登记日期 | Owner | 批准依据 |
|---|---|---|---|---|---|---|---|
| `DOC-REF-CORR-01` | `log/2026-11-14.md` | `2bdbd93e379da073cff4b1ac474189e29b8a12d51d0429621d7574d22587d0c3` | `../../docs/status/PROJECT_STATUS.md` | `../docs/status/PROJECT_STATUS.md` | `2026-11-14` | Platform | Requirement §36.16.7（`PL-RI-06`）；业务所有者 2026-11-14 批准 §36.16 与 Design §32.16 |

## 1. 登记语义与边界

1. **原文件不得改写。** `log/YYYY-MM-DD.md` 保持 append-only。登记**不**授权回写、断链补写、删除或伪造任何历史行。
2. **覆盖是三元的精确匹配。** 只有当「原文件 + 错误目标 + 原行内容哈希」三者与当前断链**完全相等**时，登记才生效。
3. **正确目标必须可达。** 正确目标按**原文件**的相对位置解析；文件存在且锚点存在才算覆盖。
4. **登记不提供通配。** 原文件与两个目标中任何通配符（`*`、`?`、`[]`、`{}`）都使登记非法。
5. **登记必须唯一。** 同一三元组不得重复登记；纠错 ID 不得重复。
6. **漂移即失效。** 原行内容变化（哈希改变）时登记不再覆盖，该断链回到未登记状态并 fail closed；不匹配的登记会被报为失效登记。
7. **登记自身的目标也必须可达。** 本文件中的相对链接由 N1 正常扫描，不得以本登记豁免自身。
8. **本登记不得成为通配豁免的后门。** 登记文件本身是受治理文件，其变更必须可追溯。

## 2. 登记行的可复算方法

原行内容哈希由下列命令现场生成（只读）：

```bash
node scripts/docs/reference-correction.mjs --file log/2026-11-14.md --target "../../docs/status/PROJECT_STATUS.md"
```

哈希口径：对**整行原文**（去掉行尾 `\r`、首尾空白）计算 SHA-256，输出 64 位小写十六进制。同一行在 CRLF 工作树与 LF Git blob 之间得到相同哈希。

## 3. 本轮登记说明

`DOC-REF-CORR-01` 登记的是 2026-11-14 开发日志第 1387 行的一条历史相对链接：该行位于 `log/` 目录下，却使用了 `../../docs/status/PROJECT_STATUS.md`（多退了两级），因此解析到仓库根之外。正确目标应为一级的 `../docs/status/PROJECT_STATUS.md`。

该行属于 append-only 历史记录，按 `PL-RI-06` 要求**不得回写**。本登记使其在 N1 中被如实报告为 `BROKEN` 并同时报告 `CORRECTED_REFERENCE` 命中，而不是被静默忽略或改写历史。
