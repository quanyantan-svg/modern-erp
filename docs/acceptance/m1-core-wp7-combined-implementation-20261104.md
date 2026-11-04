# M1-Core WP7-COMBINED Implementation 证据（2026-11-04）

> 用途：保存本工作包的 Implementation 范围、提交、离线验证与剩余阻塞，供独立审查。
> Owner：Procurement & Outsourcing Domain Owner；ACK-4 部分由 Platform / Database Safety Owner 联合维护。
> 状态：`IMPLEMENTED / READY_FOR_INDEPENDENT_REVIEW`；真实 MySQL G07 与历史 M-15 Migration 为 `NOT_RUN`。
> 权威来源：Requirement 为 `docs/requirements/procurement-outsourcing.md §31.13`；Design 为
> `docs/design/procurement-outsourcing-m1-core.md §4.4 / §4.4.1 / §9.3 / §13.1.1–§13.1.4 / §14 RISK-9`
> 与 `solution.md §15.1`；项目级当前状态只由 `docs/status/PROJECT_STATUS.md §37.32` 维护。
> 本文件是 Implementation 证据，不是 Requirement、Design、Gate PASS、Acceptance、Freeze 或 Release 记录。

## 1. 基线、授权与提交

| 项 | 值 |
|---|---|
| Repository / Branch | `quanyantan-svg/modern-erp` / `work/m1-core-rebaseline-20261102` |
| 起始 SHA | `6088a501480aaa004b836979aacb805deabeba21` |
| 起始双远端 | GitHub/Gitee 同分支均为起始 SHA |
| B | `84bca44` — CR-02/04/05 与 `notice_no` |
| A | `c8145c2` — ACK-4 安全基础设施 |
| C | `cb8538a` — M-15 离线 schema/migration/fail-closed |
| D | `b49afed` — G07 Oracle、真实 integration 壳、Schema Parity、portable Child Lease |
| 版本 / tag | `package.json` `1.6.2` 未变；既有 release tag 未移动、删除或新建 |

用户已明确授权上述 Implementation 与 M-15 的代码/schema/隔离测试，未授权真实 MySQL、数据库创建/删除/重置、
destructive Gate、历史 Migration、Push、Merge、Tag、Release 或 Deploy。本轮严格保持该边界。

## 2. ACK-4 入口覆盖

| 入口族 | 处置 | 离线证据 |
|---|---|---|
| PowerShell launcher | 固定 allowlist，仅 M1 专用脚本可登记；不签发批准 | source contract + simulated refusal |
| 独立 issuer | Windows CurrentUser DPAPI + 当前用户 ACL；治理批准字段与机器 capability 分离 | source contract |
| M1 root runner | run ID、完整 SHA、target、固定四操作 manifest；工作树不净/缺 capability 拒绝 | source contract；执行仍在消费前 BLOCKED |
| generic/concurrency/finance Gate | 无独立批准 manifest，启动即 BLOCKED | static/focused tests |
| Wave7/10/11/Inventory | 无独立批准 manifest，root runner 启动即 BLOCKED | existing runner tests retained |
| shared temp-db / reset | 首次 MySQL 写入前要求已消费 portable Child Lease 与操作子集 | direct Node refusal test |
| performance/full benchmark | 未迁移到独立 manifest，BLOCKED | static entry guard |
| upgrade/conversion | 明确要求独立 upgrade/Migration manifest，BLOCKED | static entry guard |
| real G07 integration | 原子消费 PID/父进程/SHA/target/operation 绑定的 portable Child Lease | replay/tamper/drift simulation |

纯模拟已覆盖：无凭据、过期、已消费、并发双消费、target/operation 漂移、child replay、进程树漂移、cleanup 成功、
cleanup 未证明写 quarantine、quarantine 阻止新 run。M1 lease 从未被当作其他 Domain Gate 的授权。

## 3. CR-01～CR-09 与错误合同

| CR | Implementation / Oracle | 本轮状态 |
|---|---|---|
| CR-01 | 6 vs 6 竞争容量 10；通知号事务内保留格式探测；容量败方精确 409 | SQLite focused PASS；MySQL NOT_RUN |
| CR-02 | 重复采购收货确认精确 409 `PURCHASE_RECEIPT_ALREADY_CONFIRMED`；拒绝审计 allowlist | SQLite focused PASS；MySQL NOT_RUN |
| CR-03 | 同一委外收货重复生效：200 / 409 `OUTSOURCING_RECEIPT_ALREADY_EFFECTED` | Oracle ready；MySQL NOT_RUN |
| CR-04/05 | 仅 ISSUE/SUPPLEMENT 使用 409 `OUTSOURCING_SOURCE_INVENTORY_INSUFFICIENT` | SQLite focused PASS；MySQL NOT_RUN |
| CR-06 | 退料竞争同 WIP：409 `OUTSOURCING_WIP_INSUFFICIENT` | Oracle ready；MySQL NOT_RUN |
| CR-07 | 两张合法 IQC-PASS 收货各 4 竞争 WIP 6 | Oracle ready；MySQL NOT_RUN |
| CR-08 | receipt backflush 与 return 竞争同 LOT/SERIAL identity | Oracle ready；MySQL NOT_RUN |
| CR-09 | 同一委外订单加工费 PO 终身唯一，稳定 Item | Oracle ready；MySQL NOT_RUN |

每项 Oracle 固定生产 HTTP、两个应用 session、事务门 + lock-wait 同步、恰一胜/败、精确 status/code、拒绝审计恰一、
败方零业务副作用及逐表全字段有序快照；不引用旧 `race_probe_generic`。附加 Oracle 覆盖加工费 PO Item ID 原位稳定、
通用 PO 类型/来源注入拒绝、PO Change ADD/MODIFY/CANCEL 拒绝、UAT-14 已批准 VMI 收货口径、G03 L1/L2、
安全整数分与唯一键/FK/CHECK。

## 4. `notice_no` 与 M-15

`notice_no` 格式未变：标准通知 `RN<10 digits>`、委外通知 `RN-OS-<10 digits>`。分配移入真实事务并在同一前缀空间
探测下一可用编号；不同通知不会复用编号，唯一键错误不会被转换成预期容量拒绝。未产生业务编号政策变更，故未触发
`RISK9_NEEDS_DESIGN_DECISION`。

M-15 获得独立离线授权并已实现：

- fresh current schema 的 SQLite/MySQL DDL 含 `tracked_inventory_movements.identity_key` 与委外部分唯一索引；
- historical migration 不是 startup migration，只能显式 `authorized: true` 调用；
- PRE-A 检查 source item，PRE-B 严格按真实 tracking policy 映射 `LOT:<id>` / `SERIAL:<id>` / `NONE`，
  PRE-C 检查 active duplicate；未知 LOT/SERIAL 绝不降为 NONE；
- SQLite DDL/回填整体回滚；MySQL 的 column、normalization、generated digest column、unique index 分段识别并幂等重试；
- 不删除、合并或改写历史流水；未迁移历史库的委外严格跟踪写入 fail closed。

隔离 SQLite 与纯 MySQL mock 通过不代表历史 Migration 成功。历史 Migration 仍为 `NOT_RUN / BLOCKED`。

## 5. Schema Parity 与回归

离线 parity 已证明 current snapshot、MySQL 生产 DDL translator、M-15 列/索引合同一致；真实 parity 比较器读取
`information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE / REFERENTIAL_CONSTRAINTS / CHECK_CONSTRAINTS`，逐字段比较
列顺序、类型族、NULL/default、PK/UNIQUE/index、FK 规则与 CHECK。真实 MySQL parity 为 `NOT_RUN`。

| 门禁 | 结果 |
|---|---|
| focused ACK-4 / M-15 / B / G07 / suite governance | PASS |
| `pnpm test:fast`（经 `pnpm.cmd`） | 528 tests PASS；0 fail/cancel/skip/todo |
| `pnpm test`（经 `pnpm.cmd`） | 3255 tests / 398 suites PASS；0 fail/cancel/skip/todo |
| `pnpm build`（经 `pnpm.cmd`） | PASS |
| docs current | N1、N3～N9 PASS；N2 RETIRED，不记 PASS |
| docs migration | C1～C6 PASS |
| `git diff --check` | PASS |

FAST/FULL runner 输出 `isolation=sqlite`，并明确移除环境中的 `ERP_MYSQL_TEST_ALLOW_RESET`。没有运行 HEAVY、MySQL
Gate 或 M-15 历史 Migration。G01～G06 既有 WP7-A/G05 证据文件未修改、未覆盖，原状态保持。

## 6. 剩余阻塞与 G07 最小后续授权

1. `M1C-G07` root executor 仍在 capability 消费前 BLOCKED：生产 HTTP fixture builder 与 root-managed app child、
   suite child、退出证明、cleanup/零对象证明需独立安全审查后激活；这不是 Gate PASS。
2. CR-01～CR-09、真实 `information_schema` parity 和 MySQL 行为对等必须在精确 disposable MySQL 8 上执行。
3. 历史 M-15 必须另取 Migration run 授权；不得复用 M1 G07 lease。
4. G07 执行的最小新授权必须绑定：独立审查通过的最终完整 SHA、UUIDv4 run ID、精确 target 全身份、固定有序四操作、
   15 分钟 capability 消费窗口；并继续明确允许 reset/bootstrap/fixture/cleanup、禁止 CREATE/DROP DATABASE、用户/权限
   变更、M-15/历史 Migration、其他 Gate、任意脚本注入。

```text
M1C_WP7_COMBINED_IMPLEMENTATION_READY_FOR_INDEPENDENT_REVIEW
```
