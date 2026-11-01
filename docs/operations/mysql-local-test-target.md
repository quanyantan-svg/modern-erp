# 统一本机 MySQL 测试目标

> 状态：`ACTIVE`（运维运行手册）
> Owner：Platform
> 权威来源：操作目标与前置条件以本文件为准；Git release tag 与数据库 schema 事实以仓库与 MySQL 实例为准
> 来源：`README.md` @ `4cb8c477aa00988bbfebef905764565cdfe62b71`（正文逐字迁移）

---

## 统一本机 MySQL 测试目标

本机全部真实 MySQL 集成测试统一使用**同一个实例、同一个 Schema、同一个最小权限账号**：

| 项 | 值 |
|---|---|
| Host / Port | `127.0.0.1` / `3306` |
| Database | `modern_erp_domain_test` |
| User | `modern_erp_test` |
| 口令 | 不入库；由 Windows 当前用户的 DPAPI 加密保存 |

本机当前仅存两个用户项目 Schema：统一测试目标 `modern_erp_domain_test`（专用空库）与历史遗留的
`calculator_db`。`calculator_db` 仍存在 `calculation_history` 的 Missing Tablespace 问题
（其 `.ibd` 文件缺失，MySQL 错误日志持续记录），**并未恢复正常**；本项目不使用它，
受保护 Gate 也不会触碰它。

一次性设置（掩码提示输入口令 → DPAPI 保存 → 建立固定身份基线）：

```bash
pnpm test:mysql:local:setup
```

此后运行受保护 MySQL Gate 只需一条命令：

```bash
pnpm test:mysql:local                                   # 默认运行 W11-SEC Gate
powershell -File scripts/gates/run-mysql-local-gate.ps1 -Script test:mysql:wave10
```

`pnpm test:mysql:local` **当前默认只运行 W11-SEC Gate**，这**不代表全部历史 MySQL Gate 已完成适配**：

| Gate | 与统一目标的关系 |
|---|---|
| `test:mysql:wave11-sec` | 统一 launcher 的默认目标，已在本机实测通过 |
| `test:mysql:wave10` / `test:mysql:gate-b` | 复用同一受保护 runner，可用同一 launcher 调用；本轮**未**重跑 |
| `test:mysql:finance-concurrency` / `test:mysql:performance` | 可运行，但**绕过**受保护合同（不校验 disposable target 身份指纹），且其 runner 只 `DROP TABLE`、不满足五类归零清理合同；尚未接入统一 launcher |
| `test:mysql`（gate-a）/ `test:mysql:concurrency` / `test:mysql:legacy` | **尚未适配**：其并发套件要求 `information_schema.PROCESSLIST` 可见，最小权限账号无 `PROCESS` 权限；不得以扩大测试账号权限绕过 |

launcher 会依次：读取 DPAPI 凭据 → 只读核验身份与空库 → 取得机器级互斥锁（所有会清理 Schema 的 Gate 串行执行）→ 运行 Gate → 用新会话复核五类对象归零。

固定身份基线（server UUID / CURRENT_USER / grants SHA-256）保存在
`%LOCALAPPDATA%\ModernERP\mysql-gate\target.json`，**只被比较，从不被重新生成**；
身份漂移会被拒绝启动，重新建立基线必须显式执行 setup 脚本。

**运行前提**（launcher 的只读 preflight 逐项核验，任一不满足即拒绝启动 Gate）：

- `MySQL80` 服务正常运行，`127.0.0.1:3306` 可达；
- 固定身份基线有效 —— server UUID / CURRENT_USER / grants SHA-256 与基线一致，漂移即拒绝启动；
- 专用数据库 `modern_erp_domain_test` 初始为空（五类对象计数全 0）；
- 最小权限合同匹配 —— 由仓库既有 `assertExactLeastPrivilegeGrants` 核验，本仓库不复制第二份权限清单；
- Trigger bootstrap 前置条件满足 —— 见下节。

**Trigger bootstrap 前置条件（`log_bin_trust_function_creators`）**：

本机 MySQL 开启二进制日志（`log_bin=1`）时，最小权限账号无法 `CREATE TRIGGER`，
而 Gate 的 Schema bootstrap 必须创建触发器（`inventory_mutation_log` 3 个 + Wave 2 价格 3 个），
因此必须开启 `log_bin_trust_function_creators=1`。这是**服务器级开关**，不改变账号授权集合，
也不改变固定身份基线。

- 该开关当前值 `1` 是**运行时设置**（`SET GLOBAL`），**不持久化**：实例配置文件未指定该项，
  `mysqld-auto.cnf` 不存在，`performance_schema.variables_info` 报 `VARIABLE_SOURCE = DYNAMIC`。
- `MySQL80` **重启后会回到默认值 `0`**。届时二进制日志仍开启，最小权限账号将无法创建触发器，
  Gate 会在 Schema bootstrap 阶段以 `ER_BINLOG_CREATE_ROUTINE_NEED_SUPER` 失败。
- 重启后必须先通过**单独的、经授权的管理员操作**恢复该前置条件，再执行 Gate。
- **普通 launcher 不得自动以 root 修改全局变量** —— 该动作不属于 Gate 流程，必须显式授权、单独执行。
- **不允许为绕过该问题扩大 `modern_erp_test` 的权限**（例如授予 `SUPER` / `SET_USER_ID`），
  也不允许改动 Schema 跳过触发器；二者都会破坏最小权限合同与业务控制。
