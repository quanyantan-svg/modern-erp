# M1C-G07-FINAL-FIX 两项真实阻塞闭合候审（2026-11-06）

> 用途：保存历史真实 Run `dcfbf040-240c-4630-b2cb-31e2e8eaa062` 的 CR-02 与 Schema Parity
> 两项失败根因、最小离线修复和审批边界。
> Owner：Procurement & Outsourcing Domain Owner（Fixture 决定）；Platform / Database Safety / QA
> （Parity 实施与证据维护）。
> 状态：`IMPLEMENTED` —— Parity 修复已离线实施；Owner 已明确批准并激活 CR-02 固定 Fixture
> digest `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091`。真实 G07 尚未重跑，
> 历史 G07=`FAIL` 与 `M1_CORE_ACCEPTANCE_BLOCKED` 保持不变。
> 权威来源：Requirement
> [`docs/requirements/procurement-outsourcing.md`](../requirements/procurement-outsourcing.md) §31.13.5；Active Design
> [`docs/design/procurement-outsourcing-m1-core.md`](../design/procurement-outsourcing-m1-core.md) §13.1；当前项目状态仅由
> [`docs/status/PROJECT_STATUS.md`](../status/PROJECT_STATUS.md) 登记。本文仅为实施/候审证据，不是新 Requirement 或 Design。

## 1. 基线与历史证据

- 实施基线：`master` @ `ee4f5242adcfed9877fb4a8b96e04d93bcf2a5ab`。
- 代码候选提交：`6d88db8d7a686f2dd283ef58373f02a6fb53b3ec`（本地，未推送）。
- 历史真实 Run：`dcfbf040-240c-4630-b2cb-31e2e8eaa062`，`9 PASS / 2 FAIL`，
  Cleanup `PROVEN`。
- 仅读输入：已有受限脱敏日志
  `%LOCALAPPDATA%/ModernERP/mysql-gate/evidence/dcfbf040-240c-4630-b2cb-31e2e8eaa062/1793887793814-suite-16296.log`。
- 本轮未重跑真实 Gate，未签发/消费 ACK-4，未连接 MySQL，未执行 Reset、Bootstrap、
  Cleanup 或 Migration。历史 G07=`FAIL` 与 Cleanup 证明保持不变。

## 2. CR-02 最小修复（Owner 已批准并激活）

失败证据为两个并发确认均返回 `409 BUSINESS_RULE_BLOCKED`，消息为采购入库单未通过
IQC。生产 Handler `confirmPurchaseReceiptCore()` 先校验重复确认，再执行权威 IQC 门禁；因此
Fixture 必须在 `convert` 后先构建并完成 PASS IQC，不得修改生产门禁或改弱并发断言。

Owner 批准的固定 Fixture 只增加两个生产 HTTP 步骤，均使用 `warehouse` 主体：

1. `POST /api/iqc`，body = `{ purchase_receipt_id: setup.convert.receipts[0].id }`；
2. `POST /api/iqc/{setup.iqc.id}/complete`，body =
   `{ result: 'PASS', inspection_quantity: 10, passed_quantity: 10, failed_quantity: 0 }`。

| 项 | 值 |
|---|---|
| 当前唯一批准/启用 digest | `9816affb5a94108723929cf8844ea1a640a71a210c604cea6cdd73fdb0d71091` |
| 被取代的历史 digest | `2202e6c21142528bd2b21f276abcacbf250af06624a456b84ec12263e15c808c`（仅保留历史追溯，不再是运行时版本） |
| 当前 builder/static preflight/测试消费对象 | 同一份 `M1_CORE_G07_FIXED_SCENARIOS` 与唯一固定 digest |
| Owner 决定 | `APPROVED / ACTIVATED`（2026-11-06） |

激活后不再保留独立的候选运行时导出；Builder、Static Preflight 与相关测试只引用唯一固定版本。
本次批准不授权真实 MySQL Gate 或 ACK-4，因此不得以本轮离线证据宣称 CR-02 真实 MySQL PASS。

## 3. Schema Parity 的 14 表逐项差异

分类：`REPRESENTATION` = MySQL/SQLite 合法元数据表示差异；`APPROVED_PHYSICAL` = 已批准的
MySQL 物理实现差异；`REAL_DEFECT` = 真实缺失/不一致。

| 表 | 脱敏日志的具体差异 | 分类与结论 |
|---|---|---|
| `receipt_notice_item_sources` | `source_trace_json`：SQLite default SQL literal `'{}'`，MySQL `COLUMN_DEFAULT` 返回解包后字符串；`UNIQUE(notice_item_id,purchase_order_item_id)` 在 SQLite 名为 `sqlite_autoindex_..._2`，MySQL 名由约束生成 | 两项均 `REPRESENTATION`；列集合、列顺序、UNIQUE 列序列一致；`REAL_DEFECT=NONE` |
| `schedule_consumption_effects` | `effect_state` 的 `'EFFECTIVE'` 引号表示；`UNIQUE(idempotency_key)` 与 `UNIQUE(business_event_type,business_event_id,business_event_item_id,reverses_effect_key)` 的 SQLite autoindex 名；CHECK 字符串常量在 MySQL 带 `_utf8mb4` introducer | 全部 `REPRESENTATION`；唯一约束成员与 CHECK 逻辑一致；`REAL_DEFECT=NONE` |
| `outsourcing_orders` | `unit='EA'`、`status='DRAFT'`、`remark=''` 的 default 字面量表示；`UNIQUE(order_no)` / `UNIQUE(planning_handoff_id)` 的 autoindex 名；`source_type` / `status` CHECK 的 `_utf8mb4` introducer | 全部 `REPRESENTATION`；`REAL_DEFECT=NONE` |
| `outsourcing_material_list` | `issued_quantity`、`supplemented_quantity`、`returned_quantity`、`backflushed_quantity`：SQLite `0` vs MySQL DECIMAL `0.000000`；`identity_evidence_state='NONE'` 的引号表示 | 全部 `REPRESENTATION`；数值和字符串语义相同；`REAL_DEFECT=NONE` |
| `outsourcing_receipts` | `business_status='CONFIRMED'` 的 default 字面量表示；`UNIQUE(receipt_no)` 的 autoindex 名 | 全部 `REPRESENTATION`；`REAL_DEFECT=NONE` |
| `outsourcing_receipt_items` | `unit_code='EA'` 的 default 字面量表示 | `REPRESENTATION`；`REAL_DEFECT=NONE` |
| `outsourcing_wip_identity_effects` | `UNIQUE(idempotency_key)` 与 `UNIQUE(event_type,business_event_id,business_event_item_id,identity_key)` 的 autoindex 名；`identity_type`、`effect_direction`、`event_type` 等 CHECK 的 `_utf8mb4` introducer | 全部 `REPRESENTATION`；`REAL_DEFECT=NONE` |
| `outsourcing_wip_identity_effect_allocations` | `UNIQUE(effect_id,source_supply_effect_id,allocation_kind)` 的 autoindex 名；`allocation_kind` CHECK 的 `_utf8mb4` introducer | 全部 `REPRESENTATION`；`REAL_DEFECT=NONE` |
| `outsourcing_wip_identity_balances` | `supplied_quantity`、`consumed_quantity`、`available_quantity`：SQLite `0` vs MySQL DECIMAL `0.000000`；`identity_type` / `evidence_state` 等 CHECK 的 `_utf8mb4` introducer | 全部 `REPRESENTATION`；数值与 CHECK 成员一致；`REAL_DEFECT=NONE` |
| `tracked_inventory_movements` | MySQL 因 `uq_tracked_outsourcing_identity` 与 `uq_tracked_post` 两个 partial UNIQUE 追加两个 `__partial_<digest>` 生成列，导致原比较器报 `COLUMN_SEQUENCE`；`identity_key=''` 的 default 表示；CHECK 的 `_utf8mb4` introducer | 生成列是 `APPROVED_PHYSICAL`（SQLite partial UNIQUE 的 MySQL digest 实现）；其余为 `REPRESENTATION`；逻辑列序列仍严格比对；`REAL_DEFECT=NONE` |
| `inventory_transactions` | `source_no=''`、`remark=''`、`valuation_status='LEGACY_UNVALUED'` 的 default 表示；`direction` CHECK 的 `_utf8mb4` introducer | 全部 `REPRESENTATION`；`REAL_DEFECT=NONE` |
| `inventory_valuation_movements` | MySQL 为表达式 UNIQUE `idx_valuation_source_identity` 及六列 `sqlite_autoindex_..._2` 各追加一个 `__partial_<digest>` 生成列，导致 `COLUMN_SEQUENCE` 与两个 `INDEX_COLUMNS`；`status='POSTED'` default 表示；CHECK 的 `_utf8mb4` introducer | 两个 digest 列/单列物理索引为 `APPROVED_PHYSICAL`（表达式或超过四列的 UNIQUE）；其余为 `REPRESENTATION`；逻辑唯一维度未缺失；`REAL_DEFECT=NONE` |
| `purchase_orders` | `remark`、`rejection_reason`、`payment_terms`、`supplier_contact_name`、`supplier_contact_phone`、`supplier_address` 的空字符串 default，以及 `business_type='STANDARD_PURCHASE'` 的字面量表示；`UNIQUE(order_no)` autoindex 名；`status` CHECK introducer | 全部 `REPRESENTATION`；`REAL_DEFECT=NONE` |
| `purchase_receipts` | `remark=''`、`billing_mode='SEPARATE'` 的 default 字面量表示；`UNIQUE(receipt_no)` autoindex 名；`status` CHECK introducer | 全部 `REPRESENTATION`；`REAL_DEFECT=NONE` |

`purchase_order_items` 与 `purchase_receipt_items` 在同一 Parity 集合中未报差异，因此不在上述 14 张失败表中。
本轮没有发现需要 DDL / Schema / Migration 修复的真实缺陷，因此未提出或执行任何 DDL。

## 4. Parity 实施边界

- default 只对已验证的元数据表示做语义化：文本值的 SQL 引号/字符集 introducer，
  以及数值列 `0` / `0.000000` 等值表示。列类型、NULLability 和错误 default 仍严格失败。
- SQLite `origin='u'` 的内联 UNIQUE 按“唯一性 + 有序列集合”比较，不再要求物理索引名与
  `sqlite_autoindex_*` 相同；缺唯一约束仍报 `UNIQUE_MISSING`。
- 只忽略由固定索引名算法可重算、且与需要 digest 实现的逻辑 UNIQUE 一一对应的
  `__partial_<digest>` 生成列。其他额外列、缺列或列顺序改变仍失败。
- digest 物理索引必须保持预期索引名、UNIQUE 属性与精确生成列；CHECK 仅去除 MySQL
  字符串常量 introducer，成员缺失或逻辑变化仍失败。

## 5. 离线验证与交付边界

- focused：`78/78 PASS`（G07 infrastructure + WP0 parity + SQLite same-source fixture + MySQL schema
  digest implementation）。
- FAST：`559/559 PASS`，0 fail / 0 skipped / 0 todo。
- Build：PASS（Vite 7 production build，1968 modules transformed）。
- syntax：全部相关 Node `--check` PASS。
- docs current：N1、N3–N9 PASS；N2 按治理决定为 `RETIRED`，不计 PASS/FAIL。
- docs migration：C1–C6 PASS。
- `git diff --check`：PASS。
- 未运行 MySQL destructive Gate，未使用旧 ACK-4，未执行 Migration，未自动重试，未 Push / Merge /
  Tag / Release / Deploy。

## 6. 暂停点

1. Owner 已批准并激活 CR-02 固定 Fixture digest；后续真实 G07 仍须另行授权。
2. 本轮 Parity 只修正已验证的元数据/物理表示差异，未弱化真实 schema 缺陷检测。
3. 历史 G07 仍为 `FAIL`；本轮不签发 G07 PASS、M1-Core Acceptance、Freeze 或 Release Readiness。

